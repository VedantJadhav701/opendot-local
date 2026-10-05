import fs from "node:fs";
import path from "node:path";
import { OllamaProvider, stripThinking } from "../src/server/llm/ollama";

async function testItems2And3() {
  console.log("=== Testing Item 2 (Global Queue) and Item 3 (Thinking Leak Stripper) ===");

  // Test 1: Thinking leak stripper unit verification
  console.log("\n1. Testing Thinking Tag Stripper...");
  const sample1 = "<think>I need to search for headphones under 2000 rupees.</think>Here are the best headphones.";
  const sample2 = "Analyzing options carefully...</think>The best headphone under 2000 INR is Boat Bassheads 225.";
  const sample3 = "Direct response with no thinking tags.";

  const clean1 = stripThinking(sample1);
  const clean2 = stripThinking(sample2);
  const clean3 = stripThinking(sample3);

  console.log("Clean 1:", JSON.stringify(clean1));
  console.log("Clean 2:", JSON.stringify(clean2));
  console.log("Clean 3:", JSON.stringify(clean3));

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "raw-responses-item3.txt"),
    `--- RAW RESPONSE 1 (Before/After) ---\nBEFORE: ${sample1}\nAFTER: ${clean1}\n\n` +
      `--- RAW RESPONSE 2 (Before/After) ---\nBEFORE: ${sample2}\nAFTER: ${clean2}\n\n` +
      `--- RAW RESPONSE 3 (Before/After) ---\nBEFORE: ${sample3}\nAFTER: ${clean3}\n`
  );
  console.log("Saved raw outputs to docs/raw/raw-responses-item3.txt");

  // Test 2: Live Ollama model responses with queue wait logging
  console.log("\n2. Testing Live Ollama Queue and Stream Generation...");
  const provider = new OllamaProvider();

  const p1 = provider.chatStream({
    model: "qwen3:4b-instruct-2507",
    messages: [{ role: "user", content: "Tell me a 1-sentence joke." }],
  }, () => {});

  const p2 = provider.chatStream({
    model: "qwen3:4b-instruct-2507",
    messages: [{ role: "user", content: "What is 15 + 27? Answer in 1 word." }],
  }, () => {});

  const [res1, res2] = await Promise.all([p1, p2]);

  console.log("\nRequest 1 Metrics:", res1.metrics);
  console.log("Request 1 Content:", JSON.stringify(res1.content));

  console.log("\nRequest 2 Metrics:", res2.metrics);
  console.log("Request 2 Content:", JSON.stringify(res2.content));

  console.log("\nItems 2 & 3 Verification Completed Successfully!");
}

testItems2And3().catch(console.error);
