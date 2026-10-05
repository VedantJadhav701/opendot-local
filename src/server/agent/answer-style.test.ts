import { sanitizeAnswerStyle } from "./answer-style";

function runTests() {
  console.log("=== Testing Item 5: Answer Style Unit Tests ===");

  // Test 1: Emoji removal
  const raw1 = "Recommendation: JBL Tune 130T is great for under ₹2000.";
  const clean1 = sanitizeAnswerStyle(raw1);
  console.log("Test 1 (Emoji Removal):", clean1);
  if (clean1.includes("✅")) {
    throw new Error("Test 1 Failed: Emoji was not removed");
  }

  // Test 3: Mid-answer "If you have any..." line must SURVIVE
  const raw3 = "If you have any issues with port binding, check firewalls.\n\nThe server runs on port 3000.\n\nLet me know if you need more help!";
  const clean3 = sanitizeAnswerStyle(raw3);
  console.log("Test 3 (Mid-answer phrase survival):", clean3);
  if (!clean3.includes("If you have any issues with port binding")) {
    throw new Error("Test 3 Failed: Mid-answer phrase was incorrectly removed!");
  }
  if (clean3.includes("Let me know if you need more help")) {
    throw new Error("Test 3 Failed: Trailing closing offer was not removed!");
  }

  console.log("All Answer Style Unit Tests PASSED!");
}

runTests();
