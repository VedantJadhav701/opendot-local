import Module from "node:module";
const origLoad = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  if (req === "server-only") return {};
  return origLoad.apply(this, arguments);
};

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractPdf } from "./pdf";
import { chunkText, countTokens } from "./chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "./db";
import { OllamaProvider } from "../llm/ollama";

async function runUserPatchMLPTSTest() {
  const userPdfPath = "C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf";
  if (!fs.existsSync(userPdfPath)) {
    console.error("FAILED: File not found at C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf");
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(userPdfPath);
  const fileBytes = pdfBuffer.length;
  const sha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

  console.log("=== USER FILE VERIFICATION (PatchMLPTS.pdf) ===");
  console.log(`Path: ${userPdfPath}`);
  console.log(`Byte Size: ${fileBytes} bytes`);
  console.log(`SHA256: ${sha256}`);

  // Extract PDF text
  const extractStart = Date.now();
  const pdfRes = await extractPdf(pdfBuffer);
  const extractTimeMs = Date.now() - extractStart;

  // Save unedited raw extraction output to docs/raw/patchmlpts-extract.txt
  fs.mkdirSync("docs/raw", { recursive: true });
  fs.writeFileSync("docs/raw/patchmlpts-extract.txt", pdfRes.fullText, "utf8");
  console.log(`✓ Saved raw extracted text (${pdfRes.fullText.length} chars) to docs/raw/patchmlpts-extract.txt`);

  // Chunking and SQLite Insertion
  const taskId = "task_user_patchmlpts";
  const dotId = "dot_user_patchmlpts";
  clearTaskChunks(taskId);

  const chunks = chunkText({
    text: pdfRes.fullText,
    source: "PatchMLPTS.pdf",
    page: 1,
    taskId,
    dotId,
  });

  saveChunks(chunks);

  // Directly query SQLite database to fetch inserted chunks verbatim
  const dbChunks = getTaskChunks(taskId);

  const tokenSizes = dbChunks.map(c => countTokens(c.text));
  const minTokens = tokenSizes.length ? Math.min(...tokenSizes) : 0;
  const maxTokens = tokenSizes.length ? Math.max(...tokenSizes) : 0;
  const avgTokens = tokenSizes.length ? Math.round(tokenSizes.reduce((a, b) => a + b, 0) / tokenSizes.length) : 0;

  console.log(`\n[SQLite Chunk Store Retrieval Stats]`);
  console.log(`- Page Count: ${pdfRes.pageCount}`);
  console.log(`- Total Extracted Chars: ${pdfRes.fullText.length}`);
  console.log(`- Total Chunks in DB: ${dbChunks.length}`);
  console.log(`- Chunk Token Sizes: min=${minTokens}, avg=${avgTokens}, max=${maxTokens}`);

  console.log(`\n[Verbatim First 3 Chunks from SQLite chunk_store Table]`);
  dbChunks.slice(0, 3).forEach((c, idx) => {
    console.log(`\n--- DB CHUNK ${idx + 1} (ID: ${c.id} | Page: ${c.page ?? 1} | Tokens: ${countTokens(c.text)}) ---`);
    console.log(c.text);
  });

  // Prepare 2500 Evidence Token Budget
  const maxEvidenceTokens = 2500;
  let promptEvidenceTokens = 0;
  const selectedChunks: typeof dbChunks = [];
  for (const c of dbChunks) {
    const ct = countTokens(c.text);
    if (promptEvidenceTokens + ct > maxEvidenceTokens && selectedChunks.length > 0) break;
    selectedChunks.push(c);
    promptEvidenceTokens += ct;
  }

  const overflowCount = dbChunks.length - selectedChunks.length;
  const overflowNotice = overflowCount > 0
    ? `\n\n[Note to Model: ${overflowCount} additional chunks (${dbChunks.length} total) from PatchMLPTS.pdf are stored locally in SQLite chunk_store database and can be recalled]`
    : "";

  const evidenceText = selectedChunks.map((c, i) => `--- Chunk ${i + 1} (Page ${c.page ?? "?"}) [ID: ${c.id}] ---\n${c.text}`).join("\n\n");
  const userPrompt = "analyze this paper and explain me in simple language that what this paper says";
  const fullPromptContent = `${userPrompt}\n\n[Attached PDF Content (PatchMLPTS.pdf) - Evidence Budget: ~${promptEvidenceTokens}/${maxEvidenceTokens} tokens (${selectedChunks.length}/${dbChunks.length} chunks included)]:\n${evidenceText}${overflowNotice}`;

  // Execute qwen3:4b
  console.log(`\nDispatching prompt to Ollama (qwen3:4b) with think:false...`);
  const ollama = new OllamaProvider();
  const answerStart = Date.now();
  let ttftMs = 0;
  let answerText = "";

  const res = await ollama.chatStream(
    {
      model: "qwen3:4b",
      messages: [
        { role: "system", content: "You are Dot, an AI assistant." },
        { role: "user", content: fullPromptContent },
      ],
      temperature: 0.2,
      context_length: 8192,
    },
    (chunk) => {
      if (chunk.delta?.content) {
        if (ttftMs === 0) ttftMs = Date.now() - answerStart;
        answerText += chunk.delta.content;
      }
    }
  );

  const totalTimeMs = Date.now() - answerStart;
  const metrics = res.metrics;

  const logLine1 = `[dots] Turn Step 1/1 | Model: qwen3:4b | TTFT: ${metrics?.ttftMs || ttftMs}ms | Total: ${metrics?.totalTimeMs || totalTimeMs}ms | Prompt Tokens: ${metrics?.promptTokens || 0} | Completion Tokens: ${metrics?.completionTokens || 0}`;
  const logLine2 = `[dots] Turn Summary | Total Time: ${metrics?.totalTimeMs || totalTimeMs}ms | Steps: 1 | Total Prompt Tokens: ${metrics?.promptTokens || 0}`;

  console.log(`\nREAL TERMINAL LOG LINES:`);
  console.log(logLine1);
  console.log(logLine2);

  console.log(`\nMODEL ANSWER TEXT:`);
  console.log(`"""\n${answerText.trim()}\n"""`);

  // Save raw log to docs/raw/run-patchmlpts.log
  const rawLogContent = `Path: ${userPdfPath}\nSize: ${fileBytes} bytes\nSHA256: ${sha256}\nExtractor Pages: ${pdfRes.pageCount}\nExtracted Chars: ${pdfRes.fullText.length}\nChunks in DB: ${dbChunks.length}\nSelected Chunks: ${selectedChunks.length}\nEvidence Tokens: ${promptEvidenceTokens}\n\nLOG LINES:\n${logLine1}\n${logLine2}\n\nMODEL ANSWER:\n${answerText}`;
  fs.writeFileSync("docs/raw/run-patchmlpts.log", rawLogContent, "utf8");
  console.log(`✓ Saved raw run log to docs/raw/run-patchmlpts.log`);
}

runUserPatchMLPTSTest().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
