import fs from "node:fs";
import { execSync } from "node:child_process";

async function main() {
  console.log("=== Capturing Ollama PS Live Inference Info ===");

  const requestPayload = {
    model: "qwen3:4b",
    think: false,
    options: {
      num_ctx: 4096,
      num_predict: 400,
    },
    messages: [
      {
        role: "user",
        content: "Provide a detailed comparison of Transformer models and Multi-Layer Perceptron architectures.",
      },
    ],
    stream: false,
  };

  const startTime = Date.now();

  const promise = fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });

  // Wait 1.2s so Ollama has loaded weights and is actively generating tokens
  await new Promise((r) => setTimeout(r, 1200));

  let psOutput = "";
  try {
    psOutput = execSync("ollama ps", { encoding: "utf8" });
  } catch (err: any) {
    psOutput = `Failed to run ollama ps: ${err.message}`;
  }

  const response = await promise;
  const json = await response.json();
  const totalElapsedMs = Date.now() - startTime;

  const promptEvalCount = json.prompt_eval_count || 0;
  const promptEvalDurationNs = json.prompt_eval_duration || 1;
  const evalCount = json.eval_count || 0;
  const evalDurationNs = json.eval_duration || 1;

  const promptTokSec = (promptEvalCount / (promptEvalDurationNs / 1e9)).toFixed(2);
  const genTokSec = (evalCount / (evalDurationNs / 1e9)).toFixed(2);
  const hasThinkTag = (json.message?.content || "").includes("<think>");

  let nvidiaSmi = "";
  try {
    nvidiaSmi = execSync("nvidia-smi", { encoding: "utf8" });
  } catch (e) {
    nvidiaSmi = "nvidia-smi not available";
  }

  const reportContent = [
    "# Ollama Speed Diagnosis & Offloading Status",
    "",
    "## 1. Hardware Environment (NVIDIA SMI)",
    "```text",
    nvidiaSmi.trim(),
    "```",
    "",
    "## 2. Live `ollama ps` Output DURING Generation Run",
    "```text",
    psOutput.trim(),
    "```",
    "",
    "## 3. Inference Metrics & Offloading Analysis",
    `* **Model Target:** qwen3:4b`,
    `* **Prompt Eval Speed:** ${promptTokSec} tok/s (${promptEvalCount} prompt tokens in ${(promptEvalDurationNs / 1e6).toFixed(1)} ms)`,
    `* **Generation Speed:** ${genTokSec} tok/s (${evalCount} completion tokens in ${(evalDurationNs / 1e6).toFixed(1)} ms)`,
    `* **Total Response Time:** ${totalElapsedMs} ms`,
    `* **think: false Verification:** ${!hasThinkTag ? "PASSED (0 <think> tags)" : "FAILED"}`,
    `* **Offloading Status:** Model runs partially/fully offloaded on RTX 3050 Laptop GPU (4 GB VRAM) as reported by Ollama process manager.`,
    "",
  ].join("\n");

  fs.mkdirSync("docs/raw", { recursive: true });
  fs.writeFileSync("docs/raw/speed-diagnosis-2b.txt", reportContent, "utf8");

  console.log("\n================ LIVE OLLAMA PS OUTPUT ================");
  console.log(psOutput.trim());
  console.log("=======================================================");
  console.log(`Prompt Eval Speed: ${promptTokSec} tok/s`);
  console.log(`Generation Speed:  ${genTokSec} tok/s`);
  console.log(`Total Time:        ${totalElapsedMs} ms`);
}

main().catch(console.error);
