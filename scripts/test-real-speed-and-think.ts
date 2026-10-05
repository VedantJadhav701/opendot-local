import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText, countTokens } from "../src/server/context/chunker";

async function main() {
  console.log("=== Speed Diagnosis & Reasoning Leak Fix on Real 2500-Token Evidence Prompt ===");

  const patchPath = fs.existsSync("C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf")
    ? "C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf"
    : path.join("uploads", "PatchMLPTS.pdf");

  const buf = fs.readFileSync(patchPath);
  const extract = await extractPdf(buf);

  const chunks = chunkText({
    text: extract.fullText,
    source: "PatchMLPTS.pdf",
    taskId: "t_speed",
    dotId: "d_speed",
  });

  // Select 2500 tokens of real evidence text
  let evidenceText = "";
  let currentTokens = 0;
  for (const c of chunks) {
    const t = countTokens(c.text);
    if (currentTokens + t <= 2500) {
      evidenceText += `\n--- Chunk (Page ${c.page || 1}) ---\n${c.text}\n`;
      currentTokens += t;
    } else {
      break;
    }
  }

  console.log(`Prepared Real Evidence Prompt: ${currentTokens} evidence tokens (${evidenceText.length} bytes).`);

  const requestBody = {
    model: "qwen3:4b",
    think: false, // Top-level think: false parameter
    system: "Answer directly in 2-3 sentences. No preamble or internal reasoning.",
    options: {
      num_ctx: 4096,
      num_predict: 400,
    },
    messages: [
      {
        role: "user",
        content: `Document Context:\n${evidenceText}\n\nUser Question: What is Patch-MLP-TS and what failure mode was identified during development?`,
      },
    ],
    stream: false,
  };

  const startTime = Date.now();

  const promise = fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  // Wait 1.5 seconds so Ollama is actively processing prompt / generating
  await new Promise((r) => setTimeout(r, 1500));

  let psOutput = "";
  try {
    psOutput = execSync("ollama ps", { encoding: "utf8" });
  } catch (err: any) {
    psOutput = `Failed to run ollama ps: ${err.message}`;
  }

  const res = await promise;
  const json = await res.json();
  const totalMs = Date.now() - startTime;

  const promptTokens = json.prompt_eval_count || 0;
  const promptNs = json.prompt_eval_duration || 1;
  const evalTokens = json.eval_count || 0;
  const evalNs = json.eval_duration || 1;

  const promptTokSec = (promptTokens / (promptNs / 1e9)).toFixed(2);
  const genTokSec = (evalTokens / (evalNs / 1e9)).toFixed(2);

  const rawAnswer = json.message?.content || "";
  const hasThinkTag = rawAnswer.includes("<think>");

  // Post-processing function to strip any residual reasoning
  const cleanedAnswer = rawAnswer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(Let me|Hmm|Okay|First|Looking at|Based on the context,?\s*)+/i, "")
    .trim();

  let nvidiaSmi = "";
  try {
    nvidiaSmi = execSync("nvidia-smi", { encoding: "utf8" });
  } catch (e) {
    nvidiaSmi = "nvidia-smi not available";
  }

  console.log("\n================ UNEDITED OLLAMA PS OUTPUT ================");
  console.log(psOutput.trim());
  console.log("===========================================================");
  console.log(`Prompt Eval Tokens: ${promptTokens} (${promptTokSec} tok/s)`);
  console.log(`Generation Eval Tokens: ${evalTokens} (${genTokSec} tok/s)`);
  console.log(`Total Time: ${totalMs} ms`);
  console.log(`Has <think> tag?: ${hasThinkTag}`);
  console.log(`\nRAW MODEL ANSWER:\n${rawAnswer}`);
  console.log(`\nCLEANED ANSWER:\n${cleanedAnswer}`);

  const speedReport = [
    "# Real 2500-Token Evidence Speed Diagnosis & Reasoning Leak Fix",
    "",
    "## 1. Unedited `nvidia-smi` Output",
    "```text",
    nvidiaSmi.trim(),
    "```",
    "",
    "## 2. Unedited `ollama ps` Output DURING 2500-Token Inference",
    "```text",
    psOutput.trim(),
    "```",
    "",
    "## 3. Real Prompt Speed Metrics",
    `* **Model:** qwen3:4b`,
    `* **Prompt Evidence Size:** ${currentTokens} tokens (${evidenceText.length} bytes)`,
    `* **Prompt Eval Speed:** ${promptTokSec} tok/s (${promptTokens} prompt tokens in ${(promptNs / 1e6).toFixed(1)} ms)`,
    `* **Generation Speed:** ${genTokSec} tok/s (${evalTokens} completion tokens in ${(evalNs / 1e6).toFixed(1)} ms)`,
    `* **Total Response Latency:** ${totalMs} ms`,
    `* **think: false Verification:** Top-level parameter verified. ${!hasThinkTag ? "0 <think> tags found." : "Contains think tags."}`,
    "",
    "## 4. Raw Sample Answer",
    "```text",
    rawAnswer,
    "```",
    "",
    "## 5. Cleaned Answer (Post-processed)",
    "```text",
    cleanedAnswer,
    "```",
  ].join("\n");

  fs.mkdirSync("docs/raw", { recursive: true });
  fs.writeFileSync("docs/raw/speed-diagnosis-2b-real.txt", speedReport, "utf8");
  console.log("\nSaved speed report to docs/raw/speed-diagnosis-2b-real.txt");
}

main().catch(console.error);
