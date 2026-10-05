import fs from "node:fs";
import path from "node:path";
import { getProvider, activeModel } from "../src/server/llm";
import { systemPrompt } from "../src/server/agent/prompt";
import { toolsForDot, findTool } from "../src/server/agent/tools";
import * as computer from "../src/server/computer";
import type { Dot } from "@/lib/types";

async function diagnose() {
  console.log("=== Diagnosing Failures A and B ===");

  const dummyDot: Dot = {
    id: "dot_diag",
    name: "OpenDot",
    avatar: "🤖",
    description: "Assistant",
    personality: "helpful",
    rules: [],
    status: "idle",
    localAccess: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const modelName = await activeModel("qwen3:4b");
  const provider = getProvider();

  const toolDefs = toolsForDot(dummyDot).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    },
  }));

  const sysMsg = systemPrompt(dummyDot, { kind: "chat" });

  // --- Failure A Diagnosis ---
  console.log("\n--- Failure A: URL Request ---");
  const msgA = [
    { role: "system" as const, content: sysMsg },
    { role: "user" as const, content: "go to this url: https://zenodo.org/records/23047307 and download the paper" },
  ];

  const resA = await provider.chat(
    {
      model: modelName,
      messages: msgA,
      tools: toolDefs,
      temperature: 0.2,
    },
    new AbortController().signal
  );

  console.log("Failure A Raw Model Response:");
  console.log(JSON.stringify(resA, null, 2));

  // --- Failure B Diagnosis ---
  console.log("\n--- Failure B: Headphone Search ---");
  const msgB = [
    { role: "system" as const, content: sysMsg },
    { role: "user" as const, content: "find a best headphone under 2000 rs" },
  ];

  const resB = await provider.chat(
    {
      model: modelName,
      messages: msgB,
      tools: toolDefs,
      temperature: 0.2,
    },
    new AbortController().signal
  );

  console.log("Failure B Step 1 Raw Model Response:");
  console.log(JSON.stringify(resB, null, 2));

  // Execute run_command as model would call it
  const commandToRun = "search 'best headphones under 2000 rs'";
  console.log(`\nExecuting run_command: ${commandToRun}`);
  const toolResult = await computer.runCommand("dot_diag", commandToRun, new AbortController().signal);
  console.log("Failure B Tool Result Output:");
  console.log(toolResult);

  const diagReport = [
    "# Diagnosis Report: Failures A & B",
    "",
    "## System Prompt Sent to Ollama (`qwen3:4b`)",
    "```text",
    sysMsg,
    "```",
    "",
    "## Tool Definitions Sent to Model",
    "```json",
    JSON.stringify(toolDefs, null, 2),
    "```",
    "",
    "## Failure A: URL Download Prompt",
    "### Message List Sent to Ollama",
    "```json",
    JSON.stringify(msgA, null, 2),
    "```",
    "### Raw Model Response (Failure A)",
    "```json",
    JSON.stringify(resA, null, 2),
    "```",
    "",
    "## Failure B: Search Headphones Prompt",
    "### Message List Sent to Ollama",
    "```json",
    JSON.stringify(msgB, null, 2),
    "```",
    "### Raw Model Response (Step 1 Failure B)",
    "```json",
    JSON.stringify(resB, null, 2),
    "```",
    "### Tool Result Output for `run_command` (`search 'best headphones under 2000 rs'`)",
    "```text",
    toolResult,
    "```",
    "",
    "## Loop Guard & Deduplication Analysis",
    "* **Why loop guard did not stop Failure B:** `runtime.ts` executed a fixed `for (let step = 0; step < MAX_STEPS; step++)` loop (MAX_STEPS = 6). On each step, the model called `run_command` with the exact same argument (`search 'best headphones under 2000 rs'`). Because `runtime.ts` had no check for duplicate `(toolName, args)` in the same turn, all 6 steps executed the same failing shell command repeatedly.",
    "* **Which tools step cap and URL dedupe covered:** Step cap only covered the maximum turn count (6 steps) but did not force a final non-tool answer or block duplicate calls. URL dedupe only existed in external scraping scripts, not in `runtime.ts` runtime loop.",
  ].join("\n");

  fs.mkdirSync("docs/raw", { recursive: true });
  fs.writeFileSync("docs/raw/diagnosis-ab.txt", diagReport, "utf8");
  console.log("\nSaved diagnosis to docs/raw/diagnosis-ab.txt");
}

diagnose().catch(console.error);
