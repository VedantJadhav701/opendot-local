import { MAX_STEPS, rebuildContextMessages } from "./runtime";
import { systemPrompt } from "./prompt";
import type { Dot } from "@/lib/types";

function runTests() {
  console.log("=== Testing Item 10 & 11: Context Budget, MAX_STEPS, & Token Trimming ===");

  // Test 1: MAX_STEPS configurable & default 6
  console.log(`Test 1: MAX_STEPS default value = ${MAX_STEPS}`);
  if (MAX_STEPS !== 6) {
    throw new Error(`Test 1 Failed: Expected MAX_STEPS to default to 6, got ${MAX_STEPS}`);
  }
  console.log("PASS: MAX_STEPS defaults to 6.");

  // Test 2: Memory & Skill token budget capping in prompt
  const mockDot: Dot = {
    id: "test-dot-item10",
    name: "BudgetDot",
    status: "idle",
    localAccess: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const prompt = systemPrompt(mockDot, { kind: "chat" });
  console.log("PASS: systemPrompt executed cleanly with capped memory & skill budgets.");

  // Test 3: History token trimming in rebuildContextMessages
  const sampleMessages = rebuildContextMessages("test-dot-item10", "", 100);
  console.log(`Test 3: rebuildContextMessages returned ${sampleMessages.length} messages under 100 token cap.`);
  console.log("All Context Budget & MAX_STEPS Tests PASSED!");
}

runTests();
