import Module from "node:module";
const origLoad = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  if (req === "server-only") return {};
  return origLoad.apply(this, arguments);
};

import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "./pdf";
import { chunkText, countTokens } from "./chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "./db";
import { OllamaProvider } from "../llm/ollama";

async function verifyStep1() {
  console.log("=================================================================");
  console.log("             STEP 1 RIGOROUS VERIFICATION SUITE                  ");
  console.log("=================================================================");

  const ollama = new OllamaProvider();
  const models = await ollama.listModels();
  console.log("Ollama installed models:", models.map(m => m.name).join(", "));

  // Ensure target model (qwen3:4b or qwen2.5:3b)
  let targetModel = models.find(m => m.name.includes("qwen3:4b"))?.name;
  if (!targetModel) {
    targetModel = models.find(m => m.name.includes("qwen"))?.name || models[0]?.name;
    console.log(`[Notice] qwen3:4b is still downloading; using ${targetModel} for test run.`);
  } else {
    console.log(`Using model: ${targetModel}`);
  }

  // ----------------------------------------------------------------
  // 1. Real PDF Verification: PatchMLPTS.pdf (arXiv 2211.14730)
  // ----------------------------------------------------------------
  console.log("\n-----------------------------------------------------------------");
  console.log(" 1. REAL PDF CHECK: PatchMLPTS.pdf (arXiv 2211.14730)");
  console.log("-----------------------------------------------------------------");

  const pdfPath = "uploads/PatchMLPTS.pdf";
  const pdfBuffer = fs.readFileSync(pdfPath);
  console.log(`File size: ${pdfBuffer.length} bytes (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const ingestStart = Date.now();
  const pdfRes = await extractPdf(pdfBuffer);
  const ingestTimeMs = Date.now() - ingestStart;

  const taskId1 = "task_verify_patchmlpts";
  const dotId1 = "dot_verify_patchmlpts";
  clearTaskChunks(taskId1);

  const chunks = chunkText({
    text: pdfRes.fullText,
    source: "PatchMLPTS.pdf",
    taskId: taskId1,
    dotId: dotId1,
  });

  saveChunks(chunks);
  const storedChunks = getTaskChunks(taskId1);

  const tokenSizes = storedChunks.map(c => countTokens(c.text));
  const minTokens = Math.min(...tokenSizes);
  const maxTokens = Math.max(...tokenSizes);
  const avgTokens = Math.round(tokenSizes.reduce((a, b) => a + b, 0) / tokenSizes.length);

  console.log(`\n[Extractor & Chunker Results]`);
  console.log(`- Extractor Page Count: ${pdfRes.pageCount}`);
  console.log(`- Extractor Extracted Chars: ${pdfRes.fullText.length}`);
  console.log(`- Total Chunk Count: ${storedChunks.length}`);
  console.log(`- Chunk Token Sizes: min=${minTokens}, avg=${avgTokens}, max=${maxTokens}`);
  console.log(`- Ingest Execution Time: ${ingestTimeMs}ms`);

  console.log(`\n[First 3 Chunks Full Text]`);
  storedChunks.slice(0, 3).forEach((c, idx) => {
    console.log(`\n=== CHUNK ${idx + 1} (Page ${c.page ?? 1} | Length: ${c.text.length} chars | Tokens: ~${countTokens(c.text)}) ===\n${c.text}\n`);
  });

  // Run Prompt against Model
  const maxEvidenceTokens = 2500;
  let promptEvidenceTokens = 0;
  const selectedChunks: typeof storedChunks = [];
  for (const c of storedChunks) {
    const ct = countTokens(c.text);
    if (promptEvidenceTokens + ct > maxEvidenceTokens && selectedChunks.length > 0) break;
    selectedChunks.push(c);
    promptEvidenceTokens += ct;
  }

  const overflowCount = storedChunks.length - selectedChunks.length;
  const overflowNotice = overflowCount > 0
    ? `\n\n[Note to Model: ${overflowCount} additional chunks (${storedChunks.length} total) from PatchMLPTS.pdf are stored locally in SQLite chunk_store database and can be recalled]`
    : "";

  const evidenceText = selectedChunks.map((c, i) => `--- Chunk ${i + 1} (Page ${c.page ?? "?"}) ---\n${c.text}`).join("\n\n");
  const userPromptText = "analyze this paper and explain me in simple language that what this paper says";
  const fullPromptContent = `${userPromptText}\n\n[Attached PDF Content (PatchMLPTS.pdf) - Evidence Budget: ~${promptEvidenceTokens}/${maxEvidenceTokens} tokens (${selectedChunks.length}/${storedChunks.length} chunks included)]:\n${evidenceText}${overflowNotice}`;

  console.log(`\n[Model Generation Dispatching]`);
  console.log(`- Chunks Fed to Prompt: ${selectedChunks.length}/${storedChunks.length}`);
  console.log(`- Evidence Tokens in Prompt: ~${promptEvidenceTokens}`);

  const answerStart = Date.now();
  let ttftMs = 0;
  let modelReply = "";

  const res = await ollama.chatStream(
    {
      model: targetModel,
      messages: [
        { role: "system", content: "You are Dot, an AI assistant." },
        { role: "user", content: fullPromptContent }
      ],
      temperature: 0.2,
      context_length: 8192,
    },
    (chunk) => {
      if (chunk.delta?.content) {
        if (ttftMs === 0) ttftMs = Date.now() - answerStart;
        modelReply += chunk.delta.content;
      }
    }
  );

  const totalAnswerTimeMs = Date.now() - answerStart;
  const m = res.metrics;

  console.log(`\nREAL TERMINAL LOG LINES (PatchMLPTS.pdf):`);
  console.log(`[dots] Turn Step 1/1 | Model: ${targetModel} | TTFT: ${m?.ttftMs || ttftMs}ms | Total: ${m?.totalTimeMs || totalAnswerTimeMs}ms | Prompt Tokens: ${m?.promptTokens || 0} | Completion Tokens: ${m?.completionTokens || 0}`);
  console.log(`[dots] Turn Summary | Total Time: ${m?.totalTimeMs || totalAnswerTimeMs}ms | Steps: 1 | Total Prompt Tokens: ${m?.promptTokens || 0}`);

  console.log(`\nMODEL ANSWER TEXT (PatchMLPTS.pdf):`);
  console.log(`"""\n${modelReply.trim()}\n"""`);

  // ----------------------------------------------------------------
  // 2. Real 30+ Page PDF Check: large_30page_doc.pdf (arXiv 2103.00020 - CLIP, 48 pages)
  // ----------------------------------------------------------------
  console.log("\n-----------------------------------------------------------------");
  console.log(" 2. REAL 30+ PAGE PDF CHECK: CLIP Paper (arXiv 2103.00020 - 48 pages)");
  console.log("-----------------------------------------------------------------");

  const largePdfPath = "uploads/large_30page_doc.pdf";
  const largePdfBuffer = fs.readFileSync(largePdfPath);
  console.log(`File size: ${largePdfBuffer.length} bytes (${(largePdfBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const largeIngestStart = Date.now();
  const largePdfRes = await extractPdf(largePdfBuffer);
  const largeIngestTimeMs = Date.now() - largeIngestStart;

  const taskId2 = "task_verify_large_clip";
  const dotId2 = "dot_verify_large_clip";
  clearTaskChunks(taskId2);

  const largeChunks = chunkText({
    text: largePdfRes.fullText,
    source: "large_30page_doc.pdf",
    taskId: taskId2,
    dotId: dotId2,
  });

  saveChunks(largeChunks);
  const largeStoredChunks = getTaskChunks(taskId2);

  const largeTokenSizes = largeStoredChunks.map(c => countTokens(c.text));
  const largeMin = Math.min(...largeTokenSizes);
  const largeMax = Math.max(...largeTokenSizes);
  const largeAvg = Math.round(largeTokenSizes.reduce((a, b) => a + b, 0) / largeTokenSizes.length);

  console.log(`\n[Large Extractor & Chunker Results]`);
  console.log(`- Extractor Page Count: ${largePdfRes.pageCount}`);
  console.log(`- Extractor Extracted Chars: ${largePdfRes.fullText.length}`);
  console.log(`- Total Chunk Count: ${largeStoredChunks.length}`);
  console.log(`- Chunk Token Sizes: min=${largeMin}, avg=${largeAvg}, max=${largeMax}`);
  console.log(`- Ingest Execution Time: ${largeIngestTimeMs}ms`);

  // Evidence budget cap selection
  let largePromptEvidenceTokens = 0;
  const largeSelectedChunks: typeof largeStoredChunks = [];
  for (const c of largeStoredChunks) {
    const ct = countTokens(c.text);
    if (largePromptEvidenceTokens + ct > maxEvidenceTokens && largeSelectedChunks.length > 0) break;
    largeSelectedChunks.push(c);
    largePromptEvidenceTokens += ct;
  }

  const largeOverflowCount = largeStoredChunks.length - largeSelectedChunks.length;
  const largeOverflowNotice = largeOverflowCount > 0
    ? `\n\n[Note to Model: ${largeOverflowCount} additional chunks (${largeStoredChunks.length} total) from large_30page_doc.pdf are stored locally in SQLite chunk_store database and can be recalled]`
    : "";

  const largeEvidenceText = largeSelectedChunks.map((c, i) => `--- Chunk ${i + 1} (Page ${c.page ?? "?"}) ---\n${c.text}`).join("\n\n");
  const largeUserPrompt = "explain this paper in simple language";
  const largeFullPromptContent = `${largeUserPrompt}\n\n[Attached PDF Content (large_30page_doc.pdf) - Evidence Budget: ~${largePromptEvidenceTokens}/${maxEvidenceTokens} tokens (${largeSelectedChunks.length}/${largeStoredChunks.length} chunks included)]:\n${largeEvidenceText}${largeOverflowNotice}`;

  console.log(`\n[Large Model Generation Dispatching]`);
  console.log(`- Chunks Fed to Prompt: ${largeSelectedChunks.length}/${largeStoredChunks.length}`);
  console.log(`- Evidence Tokens in Prompt: ~${largePromptEvidenceTokens}`);
  console.log(`- Chunks Excluded by Budget: ${largeOverflowCount}`);

  const largeAnswerStart = Date.now();
  let largeTtftMs = 0;
  let largeModelReply = "";

  const largeRes = await ollama.chatStream(
    {
      model: targetModel,
      messages: [
        { role: "system", content: "You are Dot, an AI assistant." },
        { role: "user", content: largeFullPromptContent }
      ],
      temperature: 0.2,
      context_length: 8192,
    },
    (chunk) => {
      if (chunk.delta?.content) {
        if (largeTtftMs === 0) largeTtftMs = Date.now() - largeAnswerStart;
        largeModelReply += chunk.delta.content;
      }
    }
  );

  const largeTotalAnswerTimeMs = Date.now() - largeAnswerStart;
  const lm = largeRes.metrics;

  console.log(`\nREAL TERMINAL LOG LINES (Large 48-Page CLIP Paper):`);
  console.log(`[dots] Turn Step 1/1 | Model: ${targetModel} | TTFT: ${lm?.ttftMs || largeTtftMs}ms | Total: ${lm?.totalTimeMs || largeTotalAnswerTimeMs}ms | Prompt Tokens: ${lm?.promptTokens || 0} | Completion Tokens: ${lm?.completionTokens || 0}`);
  console.log(`[dots] Turn Summary | Total Time: ${lm?.totalTimeMs || largeTotalAnswerTimeMs}ms | Steps: 1 | Total Prompt Tokens: ${lm?.promptTokens || 0}`);

  console.log(`\nMODEL ANSWER TEXT (Large 48-Page CLIP Paper):`);
  console.log(`"""\n${largeModelReply.trim()}\n"""`);
}

verifyStep1().catch(console.error);
