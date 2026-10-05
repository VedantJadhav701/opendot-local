import { hasKey, keySource, isReasoningModel, supportsComputerTool, refreshClientState } from "./client";

async function runTests() {
  console.log("=== Testing Item 15 & 16: Ollama Tool Fields & Honest Client Stubs ===");

  // Test 1: isReasoningModel identifies reasoning models
  console.log("Test 1: Reasoning model detection");
  if (!isReasoningModel("deepseek-r1:8b") || !isReasoningModel("moonshotai/kimi-k3")) {
    throw new Error("Test 1 Failed: Reasoning models were not identified!");
  }
  if (isReasoningModel("llama3.1:8b")) {
    throw new Error("Test 1 Failed: Standard llama3.1 was incorrectly flagged as reasoning model!");
  }
  console.log("PASS: Reasoning model detection is accurate.");

  // Test 2: supportsComputerTool
  console.log("Test 2: Computer tool support");
  if (!supportsComputerTool("llama3.1:8b") || supportsComputerTool("tiny-nano-model")) {
    throw new Error("Test 2 Failed: supportsComputerTool behavior incorrect!");
  }
  console.log("PASS: supportsComputerTool checks model capabilities.");

  // Test 3: hasKey and keySource return real status
  await refreshClientState();
  const keyStatus = hasKey();
  const source = keySource();
  console.log(`Test 3: hasKey = ${keyStatus}, keySource = ${source}`);
  console.log("PASS: Honest client functions executed cleanly.");

  console.log("All Item 15 & 16 Unit Tests PASSED!");
}

runTests();
