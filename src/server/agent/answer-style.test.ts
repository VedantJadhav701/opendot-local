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

  // Test 2: Closing offer removal
  const raw2 = "JBL Tune 130T is ₹1,999.\n\nLet me know if you'd like help finding a specific model or checking availability!";
  const clean2 = sanitizeAnswerStyle(raw2);
  console.log("Test 2 (Closing Offer Removal):", clean2);
  if (clean2.includes("Let me know")) {
    throw new Error("Test 2 Failed: Closing offer was not removed");
  }

  console.log("All Answer Style Unit Tests PASSED!");
}

runTests();
