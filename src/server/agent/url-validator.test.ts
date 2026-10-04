import { sanitizeResponseUrls } from "./url-validator";
import type { ChatMessage } from "../llm/types";

function runTests() {
  console.log("=== Testing Item 2: URL Validator Unit Tests ===");

  const context: ChatMessage[] = [
    { role: "user", content: "Check https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize it." },
    { role: "tool", content: "Result from https://html.duckduckgo.com/html: Found 5 headphones." },
  ];

  // Test 1: User prompt URL retained
  const text1 = "Here is the summary of https://vedantjadhav.hashnode.dev/amd-llm-lab for you.";
  const sanitized1 = sanitizeResponseUrls(text1, context);
  console.log("Test 1 (Allowed User URL):", sanitized1);
  if (!sanitized1.includes("https://vedantjadhav.hashnode.dev/amd-llm-lab")) {
    throw new Error("Test 1 Failed: Allowed URL was stripped");
  }

  // Test 2: Tool output URL retained
  const text2 = "Searched via https://html.duckduckgo.com/html and found top options.";
  const sanitized2 = sanitizeResponseUrls(text2, context);
  console.log("Test 2 (Allowed Tool URL):", sanitized2);
  if (!sanitized2.includes("https://html.duckduckgo.com/html")) {
    throw new Error("Test 2 Failed: Allowed tool URL was stripped");
  }

  // Test 3: Hallucinated URL stripped/flagged
  const text3 = "This paper was published at https://arxiv.org/abs/2401.99999 as original research.";
  const sanitized3 = sanitizeResponseUrls(text3, context);
  console.log("Test 3 (Hallucinated URL):", sanitized3);
  if (sanitized3.includes("arxiv.org") || !sanitized3.includes("[unverified URL removed]")) {
    throw new Error("Test 3 Failed: Hallucinated URL was not stripped");
  }

  console.log("All URL Validator Unit Tests PASSED!");
}

runTests();
