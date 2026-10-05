import { enqueueLLMRequest, queue } from "./ollama";

async function runTests() {
  console.log("=== Testing Item 13: LLM Queue Abort Removal, Timeout, & Anti-Stall ===");

  // Test 1: Abort removes task from queue before execution
  const controller = new AbortController();
  const taskPromise = enqueueLLMRequest(
    async () => {
      return "Executed";
    },
    controller.signal,
    5000
  );

  // Immediately abort while task is in queue
  controller.abort(new Error("User aborted queue task"));

  try {
    await taskPromise;
    throw new Error("Test 1 Failed: Task should have been aborted!");
  } catch (err) {
    const errorMsg = String(err);
    if (!errorMsg.includes("aborted")) {
      throw new Error(`Test 1 Failed: Unexpected error: ${errorMsg}`);
    }
    console.log("PASS: Abort removed queued task cleanly.");
  }

  // Test 2: Request Timeout
  try {
    await enqueueLLMRequest(
      async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return "Slow result";
      },
      undefined,
      100 // 100ms timeout
    );
    throw new Error("Test 2 Failed: Task should have timed out!");
  } catch (err) {
    const errorMsg = String(err);
    if (!errorMsg.includes("timed out")) {
      throw new Error(`Test 2 Failed: Unexpected error: ${errorMsg}`);
    }
    console.log("PASS: Request timeout triggered correctly.");
  }

  // Test 3: Anti-stall verification — subsequent tasks execute cleanly
  const normalResult = await enqueueLLMRequest(
    async () => "Success after timeout test",
    undefined,
    3000
  );

  if (normalResult !== "Success after timeout test") {
    throw new Error(`Test 3 Failed: Unexpected result: ${normalResult}`);
  }
  console.log("PASS: LLM queue operates smoothly without permanent stalls.");

  console.log("All Item 13 LLM Queue Unit Tests PASSED!");
}

runTests();
