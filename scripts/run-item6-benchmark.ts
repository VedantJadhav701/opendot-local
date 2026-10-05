import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";
import { saveChunks } from "../src/server/context/db";
import { db } from "../src/server/db";

async function runTurnSync(dotId: string, text: string, conversationId: string, maxMs = 300000) {
  sendMessage(dotId, text, [], conversationId);
  const start = Date.now();
  let startedWorking = false;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 500));
    const d = repo.getDot(dotId);
    if (!d) continue;
    if (d.status === "working") {
      startedWorking = true;
    }
    if (startedWorking && d.status === "idle") {
      return Date.now() - start;
    }
  }
  return Date.now() - start;
}

async function runItem6Benchmark() {
  console.log("=== Running Item 6 Comprehensive Benchmarks & Model Comparison ===");

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Capture ollama ps output
  let ollamaPsOutput = "";
  try {
    ollamaPsOutput = execSync("ollama ps", { encoding: "utf8" });
  } catch (err: any) {
    ollamaPsOutput = `ollama ps error: ${err.message}`;
  }
  console.log("Captured ollama ps:\n", ollamaPsOutput);

  let report = "=== ITEM 6 BENCHMARK REPORT ===\n";
  report += `Timestamp: ${new Date().toISOString()}\n\n`;
  report += "--- 1. OLLAMA PS SNAPSHOT ---\n";
  report += ollamaPsOutput + "\n\n";

  const dot = repo.findDotByName("OpenDot") || repo.createDot({
    name: "OpenDot",
    purpose: "Item 6 Benchmark Agent",
    look: { color: "blue", avatar: "robot" },
  });

  // ---------------------------------------------------------------- 2. Four Live Prompts
  report += "--- 2. FOUR LIVE PROMPTS TIMING & TOOL CALL DATA (Model: qwen3:4b-instruct-2507-q4_K_M) ---\n\n";
  repo.updateDot(dot.id, { model: "qwen3:4b-instruct-2507-q4_K_M", status: "idle" });

  const fourPrompts = [
    { label: "Zenodo Download", text: "go to this url: https://zenodo.org/records/23047307 and download the paper" },
    { label: "Headphones Search", text: "find a best headphone under 2000 rs" },
    { label: "Hashnode Summary", text: "Browse https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize the key takeaways" },
    { label: "PDF Explain", text: "Based on PatchMLPTS.pdf in context, what is discussed on the final page regarding future work?" },
  ];

  // Ingest PatchMLPTS.pdf for prompt 4
  const pdfPath = path.join(process.cwd(), "docs", "raw", "PatchMLPTS.pdf");
  if (fs.existsSync(pdfPath)) {
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfExt = await extractPdf(pdfBuf);
    const chunks = chunkText({ text: pdfExt.fullText, source: "PatchMLPTS.pdf", taskId: "item6_task", dotId: dot.id });
    saveChunks(chunks);
  }

  for (const p of fourPrompts) {
    db().prepare("UPDATE dots SET status = 'idle' WHERE id = ?").run(dot.id);
    const conv = repo.createConversation(dot.id, "chat", `Item6 - ${p.label}`);
    console.log(`Running Prompt: ${p.label}...`);
    const duration = await runTurnSync(dot.id, p.text, conv.id, 180000);

    const msgs = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === conv.id);
    report += `[PROMPT: ${p.label}]\n`;
    report += `Prompt Text: "${p.text}"\n`;
    report += `Total Turn Time: ${duration} ms\n`;
    report += `Ordered Messages & Tool Actions (${msgs.length}):\n`;
    for (const m of msgs) {
      report += `  - [${m.role.toUpperCase()}]: ${m.text.slice(0, 300).replace(/\n/g, " ")}\n`;
    }
    report += "\n";
  }

  // ---------------------------------------------------------------- 3. Ten Prompt Comparison (4b vs 1.7b)
  report += "--- 3. 10-PROMPT MODEL COMPARISON (qwen3:4b-instruct-2507-q4_K_M vs qwen3:1.7b) ---\n\n";

  const evalPrompts = [
    "What is 15 multiplied by 24?",
    "find a best headphone under 2000 rs",
    "go to this url: https://zenodo.org/records/23047307 and download the paper",
    "Browse https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize key takeaways",
    "Write a python function to check if a string is a palindrome.",
    "List 3 major features of Next.js Turbopack.",
    "What is the capital of France and its population?",
    "Explain what a transformer architecture is in 2 sentences.",
    "Create a JSON object representing a user with name, age, and email.",
    "Summarize the main conclusion of PatchMLPTS.pdf.",
  ];

  const models = ["qwen3:4b-instruct-2507-q4_K_M", "qwen3:1.7b"];

  for (const modelTag of models) {
    report += `================================================================\n`;
    report += `MODEL: ${modelTag}\n`;
    report += `================================================================\n`;
    repo.updateDot(dot.id, { model: modelTag, status: "idle" });

    for (let i = 0; i < evalPrompts.length; i++) {
      const q = evalPrompts[i];
      db().prepare("UPDATE dots SET status = 'idle' WHERE id = ?").run(dot.id);
      const conv = repo.createConversation(dot.id, "chat", `Eval P${i + 1} - ${modelTag}`);

      console.log(`Model ${modelTag} | P${i + 1}: "${q.slice(0, 40)}..."`);
      const startMs = Date.now();
      const turnMs = await runTurnSync(dot.id, q, conv.id, 120000);

      const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === conv.id);
      const lastDotMsg = msgs.filter((m) => m.role === "dot").pop();
      const activityMsgs = msgs.filter((m) => m.role === "activity");

      const hasToolCall = activityMsgs.length > 0;
      const hasRepeatedCall = activityMsgs.some((m, idx) => activityMsgs.findIndex((other) => other.text === m.text) !== idx);
      const answerCorrect = Boolean(lastDotMsg && lastDotMsg.text.length > 10 && !lastDotMsg.text.includes("Error"));

      report += `Prompt ${i + 1}: "${q}"\n`;
      report += `  - Total Time: ${turnMs} ms\n`;
      report += `  - Valid Tool Call: ${hasToolCall ? "YES" : "NO"}\n`;
      report += `  - Repeated Calls: ${hasRepeatedCall ? "YES" : "NO"}\n`;
      report += `  - Answer Correctness: ${answerCorrect ? "PASS" : "FAIL"}\n`;
      report += `  - Final Answer Snippet: ${lastDotMsg ? lastDotMsg.text.slice(0, 150).replace(/\n/g, " ") : "(no reply)"}\n\n`;
    }
  }

  const outPath = path.join(outDir, "model-comparison-item6.txt");
  fs.writeFileSync(outPath, report);
  console.log(`Saved Item 6 benchmark report to ${outPath}`);
}

runItem6Benchmark().catch(console.error);
