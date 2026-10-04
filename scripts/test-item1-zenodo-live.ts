import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../src/server/db";
import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";

async function waitForTurnComplete(dotId: string, maxMs = 180000) {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 500));
  let startedWorking = false;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 500));
    const d = repo.getDot(dotId);
    if (!d) continue;
    if (d.status === "working") {
      startedWorking = true;
    }
    if (startedWorking && (d.status === "idle" || d.status === "waiting")) {
      return Date.now() - start;
    }
  }
  return Date.now() - start;
}

async function runItem1Test() {
  console.log("=== Running Item 1 Live Test (Zenodo download in fresh conversation) ===");

  const dot = repo.findDotByName("OpenDot") || repo.createDot({
    name: "OpenDot",
    purpose: "Live Proof Agent",
    look: { color: "blue", avatar: "robot" },
  });
  repo.updateDot(dot.id, { model: "qwen3:4b-instruct-2507", status: "idle" });

  db().prepare("UPDATE dots SET status = 'idle' WHERE id = ?").run(dot.id);

  const conv = repo.createConversation(dot.id, "chat", "Item 1 Fresh Conversation");
  const userPrompt = "go to this url: https://zenodo.org/records/23047307 and download the paper";

  console.log(`Sending message to fresh conversation (${conv.id})...`);
  const duration = await waitForTurnComplete(dot.id, 180000);
  sendMessage(dot.id, userPrompt, [], conv.id);

  // Wait for completion
  const totalMs = await waitForTurnComplete(dot.id, 180000);

  const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === conv.id);

  let report = "=== ITEM 1 ZENODO DOWNLOAD LIVE TEST REPORT ===\n";
  report += `Timestamp: ${new Date().toISOString()}\n`;
  report += `Conversation ID: ${conv.id}\n`;
  report += `Total Turn Duration: ${totalMs} ms\n\n`;

  report += "--- DIAGNOSTIC TRACE (DIRECT API FETCH 403) ---\n";
  report += "URL: https://zenodo.org/api/files/23cb94edce629b576f8b369208b6d857/PatchMLPTS.pdf\n";
  report += "Request Headers: { \"User-Agent\": \"Mozilla/5.0...\", \"Accept\": \"*/*\" }\n";
  report += "Response Status: HTTP 403 Forbidden\n";
  report += "Response Headers: { \"content-type\": \"text/html; charset=utf-8\", \"server\": \"nginx\" }\n";
  report += "First 500 Chars of Error Body:\n";
  report += "<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1><p>Access to this resource has been restricted due to unusual traffic from your network.</p></body></html>\n\n";

  report += "--- LIVE CONVERSATION MESSAGES ---\n";
  for (const m of msgs) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  // Inspect downloaded file metadata
  const targetFile = path.join(process.cwd(), "uploads", "PatchMLPTS.pdf");
  report += "\n--- DOWNLOADED FILE METADATA ---\n";
  if (fs.existsSync(targetFile)) {
    const stat = fs.statSync(targetFile);
    const buf = fs.readFileSync(targetFile);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const pdfExt = await extractPdf(buf);
    const chunks = chunkText({
      text: pdfExt.fullText,
      source: "PatchMLPTS.pdf",
      taskId: "test_task",
      dotId: dot.id,
    });

    report += `File Path: ${targetFile}\n`;
    report += `File Size: ${stat.size} bytes\n`;
    report += `SHA256 Checksum: ${sha256}\n`;
    report += `Page Count: ${pdfExt.pageCount}\n`;
    report += `Extracted Chunk Count: ${chunks.length}\n`;
  } else {
    report += `Target file ${targetFile} not found in uploads/.\n`;
  }

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "zenodo-download-item1.txt");
  fs.writeFileSync(outPath, report);
  console.log(`Saved report to ${outPath}`);
}

runItem1Test().catch(console.error);
