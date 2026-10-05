import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText, countTokens, HARD_MAX_TOKENS } from "../src/server/context/chunker";
import { saveChunks, getTaskChunks } from "../src/server/context/db";

async function main() {
  const filePath = path.join(process.cwd(), "uploads", "large_30page_doc.pdf");
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const fileBuf = fs.readFileSync(filePath);
  const size = fileBuf.length;
  const sha256 = crypto.createHash("sha256").update(fileBuf).digest("hex");

  console.log(`Path: ${filePath}`);
  console.log(`Size: ${size} bytes`);
  console.log(`SHA256: ${sha256}`);

  const extractResult = await extractPdf(fileBuf);
  console.log(`Extractor Pages: ${extractResult.pageCount}`);
  console.log(`Extracted Chars: ${extractResult.fullText.length}`);

  const taskId = "task_clip_test";
  const dotId = "dot_clip_test";

  const chunks = chunkText({
    text: extractResult.fullText,
    source: "large_30page_doc.pdf",
    taskId,
    dotId,
  });

  saveChunks(chunks);
  const storedChunks = getTaskChunks(taskId);
  console.log(`Chunks in DB: ${storedChunks.length}`);

  const validChunks = storedChunks.filter((c) => c.status !== "dropped" && c.status !== "flagged");
  let selectedChunks = [];
  let currentTokens = 0;
  const EVIDENCE_CAP = 2500;

  for (const chunk of validChunks) {
    const t = countTokens(chunk.text);
    if (currentTokens + t <= EVIDENCE_CAP) {
      selectedChunks.push(chunk);
      currentTokens += t;
    } else {
      break;
    }
  }

  console.log(`Selected Chunks: ${selectedChunks.length}`);
  console.log(`Evidence Tokens: ${currentTokens}`);

  const contextText = selectedChunks
    .map((c, idx) => `--- Chunk ${idx + 1} (Page ${c.page || 1}, ID: ${c.id}) ---\n${c.text}`)
    .join("\n\n");

  const userPrompt = `System context (from uploaded document):\n${contextText}\n\nUser: analyze this paper and explain in simple language what this paper says.`;

  console.log("Calling Ollama qwen3:4b (think: false)...");

  const startTime = Date.now();
  let firstTokenTime = 0;
  let fullAnswer = "";

  const response = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:4b",
      think: false,
      options: { num_ctx: 8192 },
      messages: [{ role: "user", content: userPrompt }],
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama request failed: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunkStr = decoder.decode(value, { stream: true });
    const lines = chunkStr.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now() - startTime;
          }
          fullAnswer += parsed.message.content;
        }
        if (parsed.done) {
          promptTokens = parsed.prompt_eval_count || 0;
          completionTokens = parsed.eval_count || 0;
        }
      } catch (e) {
        // partial line
      }
    }
  }

  const totalTime = Date.now() - startTime;

  const logHeader = `Path: ${filePath}\nSize: ${size} bytes\nSHA256: ${sha256}\nExtractor Pages: ${extractResult.pageCount}\nExtracted Chars: ${extractResult.fullText.length}\nChunks in DB: ${storedChunks.length}\nSelected Chunks: ${selectedChunks.length}\nEvidence Tokens: ${currentTokens}\n`;

  const logLines = `\nLOG LINES:\n[dots] Turn Step 1/1 | Model: qwen3:4b | TTFT: ${firstTokenTime}ms | Total: ${totalTime}ms | Prompt Tokens: ${promptTokens} | Completion Tokens: ${completionTokens}\n[dots] Turn Summary | Total Time: ${totalTime}ms | Steps: 1 | Total Prompt Tokens: ${promptTokens}\n`;

  const outputLog = logHeader + logLines + `\nMODEL ANSWER:\n${fullAnswer}\n`;

  const logPath = path.join(process.cwd(), "docs", "raw", "run-clip.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, outputLog, "utf8");

  console.log("SUCCESS! Saved log to:", logPath);
  console.log(logLines);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
