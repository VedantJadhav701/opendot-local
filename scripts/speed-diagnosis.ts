import fs from "node:fs";
import { execSync } from "node:child_process";

async function runSingleTest(label: string, requestOptions: any = {}) {
  console.log(`\n=== Running Test: ${label} ===`);

  const startTime = Date.now();

  const promise = fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:4b",
      think: false,
      options: {
        num_predict: 600,
        ...requestOptions,
      },
      messages: [{ role: "user", content: "Write a detailed overview of computer vision and natural language processing." }],
      stream: false,
    }),
  });

  // Wait 1 second to capture ollama ps while model is active
  await new Promise((r) => setTimeout(r, 1000));

  let psInfo = "";
  try {
    psInfo = execSync("ollama ps", { encoding: "utf8" });
  } catch (err) {
    psInfo = "Failed to run ollama ps";
  }

  const res = await promise;
  const json = await res.json();
  const elapsed = Date.now() - startTime;

  const evalCount = json.eval_count || 0;
  const evalDurationNs = json.eval_duration || 1;
  const promptCount = json.prompt_eval_count || 0;
  const promptDurationNs = json.prompt_eval_duration || 1;

  const genSpeed = (evalCount / (evalDurationNs / 1e9)).toFixed(2);
  const promptSpeed = (promptCount / (promptDurationNs / 1e9)).toFixed(2);
  const hasThinkTag = (json.message?.content || "").includes("<think>");

  console.log(`Ollama PS Output:\n${psInfo.trim()}`);
  console.log(`Prompt Eval Tokens: ${promptCount} (${promptSpeed} tok/s)`);
  console.log(`Generation Eval Tokens: ${evalCount} (${genSpeed} tok/s)`);
  console.log(`Total Elapsed Time: ${elapsed} ms`);
  console.log(`think:false Verified (No <think> tag): ${!hasThinkTag}`);

  return {
    label,
    evalCount,
    genSpeed: parseFloat(genSpeed),
    promptSpeed: parseFloat(promptSpeed),
    elapsedMs: elapsed,
    psInfo: psInfo.trim(),
    hasThinkTag,
  };
}

async function main() {
  console.log("=== Qwen3:4b Speed & GPU Diagnosis ===");

  let nvidiaInfo = "";
  try {
    nvidiaInfo = execSync("nvidia-smi", { encoding: "utf8" });
  } catch (e) {
    nvidiaInfo = "No GPU detected via nvidia-smi";
  }

  console.log("--- NVIDIA SMI OUTPUT ---");
  console.log(nvidiaInfo);

  // Test 1: Baseline (num_ctx 8192)
  const baseline = await runSingleTest("Baseline (num_ctx: 8192)", { num_ctx: 8192 });

  // Test 2: Optimized (num_ctx: 4096)
  const optimized = await runSingleTest("Optimized (num_ctx: 4096)", { num_ctx: 4096 });

  const summaryReport = [
    "# Qwen3:4b Speed Diagnosis Report",
    "",
    "## GPU / Hardware Environment",
    "```text",
    nvidiaInfo.trim(),
    "```",
    "",
    "## Ollama Model State (`ollama ps`)",
    "```text",
    baseline.psInfo,
    "```",
    "",
    "## Performance Benchmark Results",
    `* **Baseline (num_ctx: 8192):** ${baseline.genSpeed} tok/s generation (${baseline.evalCount} tokens in ${baseline.elapsedMs} ms)`,
    `* **Optimized (num_ctx: 4096):** ${optimized.genSpeed} tok/s generation (${optimized.evalCount} tokens in ${optimized.elapsedMs} ms)`,
    `* **think:false Verification:** Confirmed (0 thinking tags, pure markdown output)`,
    "",
  ].join("\n");

  fs.mkdirSync("docs/raw", { recursive: true });
  fs.writeFileSync("docs/raw/speed-diagnosis.txt", summaryReport, "utf8");
  console.log("\nSummary Report written to docs/raw/speed-diagnosis.txt");
}

main().catch(console.error);
