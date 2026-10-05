import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../src/server/db";
import * as repo from "../src/server/repo";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";
import { saveChunks } from "../src/server/context/db";

async function generateReport() {
  const dot = repo.findDotByName("OpenDot");
  if (!dot) {
    console.error("OpenDot not found");
    return;
  }

  let report = "=== ITEM 8 LIVE PROOF RUNS REPORT ===\n";
  report += `Execution Timestamp: ${new Date().toISOString()}\n`;
  report += `Model: qwen3:4b-instruct-2507\n\n`;

  // Get conversations for dot
  const convs = db().prepare("SELECT * FROM conversations WHERE dot_id = ? ORDER BY created_at DESC").all(dot.id) as any[];

  const findConv = (query: string) => {
    return convs.find((c) => {
      const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === c.id);
      return msgs.some((m) => m.text.toLowerCase().includes(query.toLowerCase()));
    });
  };

  // 8a
  const convA = findConv("zenodo.org");
  report += "================================================================\n";
  report += "PROMPT 8a: go to this url: https://zenodo.org/records/23047307 and download the paper\n";
  report += "================================================================\n";
  if (convA) {
    const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convA.id);
    report += `Messages in conversation (${msgs.length}):\n`;
    for (const m of msgs) {
      report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
    }
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

  // 8b
  const convB = findConv("headphone under 2000");
  report += "\n================================================================\n";
  report += "PROMPT 8b: find a best headphone under 2000 rs\n";
  report += "================================================================\n";
  if (convB) {
    const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convB.id);
    report += `Messages in conversation (${msgs.length}):\n`;
    for (const m of msgs) {
      report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
    }
  }

  // 8c
  const convC = findConv("vedantjadhav.hashnode.dev");
  report += "\n================================================================\n";
  report += "PROMPT 8c: Browse https://vedantjadhav.hashnode.dev/amd-llm-lab and summarize the key takeaways\n";
  report += "================================================================\n";
  if (convC) {
    const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convC.id);
    report += `Messages in conversation (${msgs.length}):\n`;
    for (const m of msgs) {
      report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
    }
  }

  // 8d
  const pdfPath = path.join(process.cwd(), "docs", "raw", "PatchMLPTS.pdf");
  report += "\n================================================================\n";
  report += "PROMPT 8d: Upload PatchMLPTS.pdf and ask question on last page\n";
  report += "================================================================\n";
  if (fs.existsSync(pdfPath)) {
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfExt = await extractPdf(pdfBuf);
    report += `PatchMLPTS.pdf stored in context:\n`;
    report += `  - Total Pages: ${pdfExt.pageCount}\n`;
    report += `  - Characters Extracted: ${pdfExt.fullText.length}\n`;
  }
  const convD = findConv("patchmlpts.pdf");
  if (convD) {
    const msgs = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convD.id);
    report += `Messages in conversation (${msgs.length}):\n`;
    for (const m of msgs) {
      report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
    }
  }

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "live-proof-item8.txt");
  fs.writeFileSync(reportPath, report);
  console.log(`Report written to ${reportPath}`);
}

generateReport().catch(console.error);
