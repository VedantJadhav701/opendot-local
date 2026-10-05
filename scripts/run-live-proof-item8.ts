import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../src/server/db";
import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";
import { saveChunks } from "../src/server/context/db";

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

function clearDotState(dotId: string) {
  db().prepare("UPDATE dots SET status = 'idle' WHERE id = ?").run(dotId);
}

async function runLiveProof() {
  console.log("=== Starting Item 8 Live Proof Runs (Model: qwen3:4b-instruct-2507) ===");

  const dot = repo.findDotByName("OpenDot") || repo.createDot({
    name: "OpenDot",
    purpose: "Live Proof Agent",
    look: { color: "blue", avatar: "robot" },
  });
  repo.updateDot(dot.id, { model: "qwen3:4b-instruct-2507", status: "idle" });

  let report = "=== ITEM 8 LIVE PROOF RUNS REPORT ===\n";
  report += `Execution Timestamp: ${new Date().toISOString()}\n`;
  report += `Model: qwen3:4b-instruct-2507\n\n`;

  // ---------------------------------------------------------------- Prompt 8a
  console.log("\n--- Executing Prompt 8a ---");
  clearDotState(dot.id);
  report += "================================================================\n";
  report += "PROMPT 8a: go to this url: https://zenodo.org/records/23047307 and download the paper\n";
  report += "================================================================\n";

  const convA = repo.createConversation(dot.id, "chat", "Live Proof 8a");
  const durationA = await runTurnSync(
    dot.id,
    "go to this url: https://zenodo.org/records/23047307 and download the paper",
    convA.id
  );

  const msgsA = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === convA.id);
  report += `Total Turn Time: ${durationA} ms\n`;
  report += `Messages in conversation (${msgsA.length}):\n`;
  for (const m of msgsA) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    report += `\nFiles in uploads directory (${files.length}):\n`;
    for (const f of files) {
      const filePath = path.join(uploadsDir, f);
      const stat = fs.statSync(filePath);
      const buf = fs.readFileSync(filePath);
      const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      report += `  - Path: ${filePath}\n`;
      report += `    Size: ${stat.size} bytes\n`;
      report += `    SHA256: ${sha256}\n`;
    }
  }

  // ---------------------------------------------------------------- Prompt 8b
  console.log("\n--- Executing Prompt 8b ---");
  clearDotState(dot.id);
  report += "\n================================================================\n";
  report += "PROMPT 8b: find a best headphone under 2000 rs\n";
  report += "================================================================\n";

  const convB = repo.createConversation(dot.id, "chat", "Live Proof 8b");
  const durationB = await runTurnSync(dot.id, "find a best headphone under 2000 rs", convB.id);

  const msgsB = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === convB.id);
  report += `Total Turn Time: ${durationB} ms\n`;
  report += `Messages in conversation (${msgsB.length}):\n`;
  for (const m of msgsB) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  // ---------------------------------------------------------------- Prompt 8c
  console.log("\n--- Executing Prompt 8c ---");
  clearDotState(dot.id);
  report += "\n================================================================\n";
  report += "PROMPT 8c: Browse https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize the key takeaways\n";
  report += "================================================================\n";

  const convC = repo.createConversation(dot.id, "chat", "Live Proof 8c");
  const durationC = await runTurnSync(
    dot.id,
    "Browse https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize the key takeaways",
    convC.id
  );

  const msgsC = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === convC.id);
  report += `Total Turn Time: ${durationC} ms\n`;
  report += `Messages in conversation (${msgsC.length}):\n`;
  for (const m of msgsC) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  // ---------------------------------------------------------------- Prompt 8d
  console.log("\n--- Executing Prompt 8d ---");
  clearDotState(dot.id);
  report += "\n================================================================\n";
  report += "PROMPT 8d: Upload PatchMLPTS.pdf and ask question on last page\n";
  report += "================================================================\n";

  const pdfPath = path.join(process.cwd(), "docs", "raw", "PatchMLPTS.pdf");
  if (fs.existsSync(pdfPath)) {
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfExt = await extractPdf(pdfBuf);
    const taskId = `task_liveproof_patchmlpts_${Date.now()}`;
    const chunks = chunkText({
      text: pdfExt.fullText,
      source: "PatchMLPTS.pdf",
      taskId,
      dotId: dot.id,
    });
    saveChunks(chunks);

    report += `PatchMLPTS.pdf ingested into chunk_store:\n`;
    report += `  - Total Pages: ${pdfExt.pageCount}\n`;
    report += `  - Total Chunks: ${chunks.length}\n`;
    report += `  - Task ID: ${taskId}\n`;
  }

  const convD = repo.createConversation(dot.id, "chat", "Live Proof 8d");
  const durationD = await runTurnSync(
    dot.id,
    "Based on PatchMLPTS.pdf stored in context, what is discussed on the final page (page 6) regarding future work and conclusions?",
    convD.id
  );

  const msgsD = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === convD.id);
  report += `Total Turn Time: ${durationD} ms\n`;
  report += `Messages in conversation (${msgsD.length}):\n`;
  for (const m of msgsD) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "live-proof-item8.txt");
  fs.writeFileSync(reportPath, report);
  console.log(`\nLive proof completed. Report saved to ${reportPath}`);
}

runLiveProof().catch(console.error);
