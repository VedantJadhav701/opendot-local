import { ThinkStreamFilter, stripThinking } from "./ollama";

function runTests() {
  console.log("=== Testing Item 7: ThinkStreamFilter & Split Chunks ===");

  // Test 1: Single chunk with think block
  const filter1 = new ThinkStreamFilter();
  const out1 = filter1.process("Answer: <think>internal reasoning</think> 42") + filter1.flush();
  console.log("Test 1 (Single chunk):", JSON.stringify(out1));
  if (out1 !== "Answer:  42") {
    throw new Error(`Test 1 Failed: Expected 'Answer:  42', got '${out1}'`);
  }

  // Test 2: Split <think> open tag across 2 chunks
  const filter2 = new ThinkStreamFilter();
  let out2 = filter2.process("Header text <thi");
  out2 += filter2.process("nk>hidden reasoning</think> Body text");
  out2 += filter2.flush();
  console.log("Test 2 (Split <think> open tag):", JSON.stringify(out2));
  if (out2 !== "Header text  Body text") {
    throw new Error(`Test 2 Failed: Expected 'Header text  Body text', got '${out2}'`);
  }

  // Test 3: Split </think> close tag across chunks
  const filter3 = new ThinkStreamFilter();
  let out3 = filter3.process("Start <think>thinking text...</thi");
  out3 += filter3.process("nk>Final answer");
  out3 += filter3.flush();
  console.log("Test 3 (Split </think> close tag):", JSON.stringify(out3));
  if (out3 !== "Start Final answer") {
    throw new Error(`Test 3 Failed: Expected 'Start Final answer', got '${out3}'`);
  }

  // Test 4: Normal HTML/XML tags (e.g. <div>) should NOT be filtered
  const filter4 = new ThinkStreamFilter();
  let out4 = filter4.process("<div>Hello <b>world</b></div>");
  out4 += filter4.flush();
  console.log("Test 4 (Non-think XML tags):", JSON.stringify(out4));
  if (out4 !== "<div>Hello <b>world</b></div>") {
    throw new Error(`Test 4 Failed: Non-think tags were corrupted: '${out4}'`);
  }

  console.log("All ThinkStreamFilter Tests PASSED!");
}

runTests();
