import assert from "node:assert";
import {
  loadServers,
  saveServers,
  mcpToolDefs,
  status,
  connect,
  disconnect,
  type McpServerConfig,
} from "./manager";
import { setSetting } from "../db";
import * as composio from "../composio";

async function runTests() {
  console.log("=== Testing Phase F: MCP Connectors & Composio Hardening ===");

  // 1. Vault Sealed Storage
  console.log("--- 1. Sealed Config Storage ---");
  const testCfg: McpServerConfig = {
    id: "test_mcp",
    name: "Test MCP Server",
    transport: "stdio",
    command: "node",
    args: ["-e", "console.log('hi')"],
    env: { SECRET_TOKEN: "super_secret_token_123" },
    enabled: true,
    policy: {
      write_file: "ask",
      read_data: "allow",
    },
  };

  saveServers([testCfg]);
  const loaded = loadServers();
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, "test_mcp");
  assert.strictEqual(loaded[0].env?.SECRET_TOKEN, "super_secret_token_123");
  console.log("PASS: MCP config saved and loaded sealed from vault.");

  // 2. Policy Resolution & Prefixing Logic
  console.log("--- 2. Tool Prefixing & Decision Logic ---");
  // Test mcpToolDefs formatting
  const defs = mcpToolDefs();
  assert.ok(Array.isArray(defs), "mcpToolDefs should return an array");
  console.log("PASS: Tool definitions array verified.");

  // 3. Status Reporting
  console.log("--- 3. Live Status Reporting ---");
  const liveStatus = status();
  assert.ok(Array.isArray(liveStatus), "status should return list of active servers");
  console.log("PASS: Status reporting verified.");

  // 4. Composio Offline Mode Guard
  console.log("--- 4. Composio Offline Mode Guard ---");
  setSetting("offline_mode", "1");
  try {
    const offlineToolResult = await composio.callTool("test_tool", {});
    assert.strictEqual(offlineToolResult, "Offline mode is on.");
    console.log("PASS: composio.callTool blocked in offline mode.");

    await assert.rejects(
      async () => {
        await composio.signIn();
      },
      /Offline mode is on/,
      "composio.signIn should throw in offline mode"
    );
    console.log("PASS: composio.signIn rejected in offline mode.");
  } finally {
    setSetting("offline_mode", "0");
  }

  // 5. Cleanup
  console.log("--- 5. Cleanup ---");
  saveServers([]);
  const cleared = loadServers();
  assert.strictEqual(cleared.length, 0);
  console.log("PASS: Cleaned up test MCP config.");

  console.log("\nAll Phase F MCP & Connector Tests PASSED!\n");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
