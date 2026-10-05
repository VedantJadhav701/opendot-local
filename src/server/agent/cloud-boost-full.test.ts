import http from "node:http";
import { OpenAICompatProvider } from "../llm/openai-compat";
import { CloudRateLimiter } from "../llm/cloud-rate-limiter";
import { redactForCloud } from "./privacy-gate";

async function runCloudBoostFullTests() {
  console.log("=== Testing Cloud Boost: Rate Limiter, SSE Provider, & Network Body Inspection ===");

  // 1. Rate Limiter (429 + Retry-After + Token Bucket) Test
  console.log("--- 1. Rate Limiter Tests ---");
  const limiter = new CloudRateLimiter({ rpm: 60, maxPerTurn: 2 });

  // Test turn budget
  const dotId = "dot-rate-test";
  limiter.resetTurnBudget(dotId);
  await limiter.acquire(dotId);
  await limiter.acquire(dotId);

  try {
    await limiter.acquire(dotId);
    throw new Error("FAIL: Rate limiter allowed exceeding per-turn budget!");
  } catch (err: any) {
    if (!err.message.includes("Exceeded max cloud calls per turn")) throw err;
    console.log("PASS: Per-turn call budget enforced correctly.");
  }

  // Test 429 Retry-After backoff
  const start429 = Date.now();
  await limiter.handleRetryAfter("1"); // 1 second retry-after
  const elapsed429 = Date.now() - start429;
  if (elapsed429 < 900) {
    throw new Error("FAIL: Retry-After 1s backoff slept less than expected!");
  }
  console.log(`PASS: 429 Retry-After header handled backoff (${elapsed429}ms elapsed).`);

  // 2. Mock HTTP & SSE Server Test
  console.log("--- 2. Mock SSE Server & HTTP Request Body Inspection ---");
  let lastReceivedBody: any = null;

  const server = http.createServer((req, res) => {
    let bodyStr = "";
    req.on("data", (chunk) => (bodyStr += chunk));
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "moonshotai/kimi-k3" }] }));
        return;
      }

      if (req.url === "/v1/chat/completions") {
        try {
          lastReceivedBody = JSON.parse(bodyStr);
        } catch {
          lastReceivedBody = bodyStr;
        }

        if (req.headers["accept"]?.includes("text/event-stream") || lastReceivedBody?.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "from mock cloud!" } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Non-streaming mock response" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const mockUrl = `http://127.0.0.1:${address.port}/v1`;

  const provider = new OpenAICompatProvider({
    baseUrl: mockUrl,
    apiKey: "mock-secret-key-1234567890",
    model: "moonshotai/kimi-k3",
  });

  // Test GET /v1/models
  const models = await provider.listModels();
  if (!models.some((m) => m.id === "moonshotai/kimi-k3")) {
    throw new Error("FAIL: Mock provider listModels failed to return moonshotai/kimi-k3!");
  }
  console.log("PASS: Provider listModels returned verified model ID:", models[0].id);

  // Test chatStream SSE streaming & inspect request body
  const rawSensitiveMessage = `Read file from C:\\Users\\HP\\secret.txt with password MySecret123!`;
  const sanitizedMessage = redactForCloud(rawSensitiveMessage, ["MySecret123!"]);

  let streamedResult = "";
  await provider.chatStream(
    {
      model: "moonshotai/kimi-k3",
      messages: [{ role: "user", content: sanitizedMessage }],
    },
    (chunk) => {
      if (chunk.delta?.content) streamedResult += chunk.delta.content;
    }
  );

  if (streamedResult !== "Hello from mock cloud!") {
    throw new Error(`FAIL: Unexpected stream result: "${streamedResult}"`);
  }
  console.log("PASS: SSE ChatStream completed successfully:", streamedResult);

  // Inspect actual request body sent to network
  console.log("--- 3. HTTP Request Body Redaction Inspection ---");
  const requestContent = lastReceivedBody?.messages?.[0]?.content || "";
  console.log("Inspected HTTP Request Content Body:", JSON.stringify(requestContent));

  if (requestContent.includes("C:\\Users\\HP\\secret.txt")) {
    throw new Error("FAIL: Local absolute Windows path leaked into HTTP request body!");
  }
  if (requestContent.includes("MySecret123!")) {
    throw new Error("FAIL: Plain password leaked into HTTP request body!");
  }
  if (!requestContent.includes("[REDACTED_LOCAL_PATH]") || !requestContent.includes("[REDACTED_PASSWORD]")) {
    throw new Error("FAIL: Redaction markers missing in HTTP request body!");
  }
  console.log("PASS: Verified 100% clean redaction in HTTP request body. No passwords or local absolute paths leaked.");

  server.close();
  console.log("All Cloud Boost Rate Limiter, SSE Provider, & Network Inspection Tests PASSED!");
}

runCloudBoostFullTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
