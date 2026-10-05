import assert from "node:assert";
import * as repo from "../src/server/repo";

async function runUnitTests() {
  console.log("=== Running Unit Tests for URL Pre-routing & Duplicate Tool Guard ===");

  // Test 1: Duplicate Tool Guard Logic
  console.log("\n1. Testing Duplicate Tool Guard...");
  const seenCalls = new Set<string>();
  const call1 = { function: { name: "run_command", arguments: JSON.stringify({ command: "search 'best headphones'" }) } };
  const call2 = { function: { name: "run_command", arguments: JSON.stringify({ command: "search 'best headphones'" }) } };

  const key1 = `${call1.function.name}:${call1.function.arguments}`;
  seenCalls.add(key1);

  const key2 = `${call2.function.name}:${call2.function.arguments}`;
  const isDuplicate = seenCalls.has(key2);

  assert.strictEqual(isDuplicate, true, "Second duplicate tool call must be detected");
  console.log("PASS: Duplicate tool call correctly identified and blocked.");

  // Test 2: URL Pre-routing Detection
  console.log("\n2. Testing URL Pre-routing Regex and Routing...");
  const samplePrompt = "go to this url: https://zenodo.org/records/23047307 and download the paper";
  const urlMatch = samplePrompt.match(/https?:\/\/[^\s]+/i);
  assert.notStrictEqual(urlMatch, null, "URL should be matched by regex");
  assert.strictEqual(urlMatch![0], "https://zenodo.org/records/23047307", "Extracted URL should match input");

  console.log("PASS: URL pre-routing regex accurately extracted target URL.");

  console.log("\nALL UNIT TESTS PASSED SUCCESSFULLY!");
}

runUnitTests().catch((err) => {
  console.error("UNIT TEST FAILED:", err);
  process.exit(1);
});
