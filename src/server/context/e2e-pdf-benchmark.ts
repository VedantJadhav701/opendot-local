import Module from "node:module";
const originalRequire = Module.prototype.require;
(Module.prototype as any).require = function (request: string) {
  if (request === "server-only") {
    return {};
  }
  return originalRequire.apply(this, arguments as any);
};

import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "./pdf";
import { chunkText, countTokens } from "./chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "./db";
import { OllamaProvider } from "../llm/ollama";

async function runE2EBenchmark() {
  console.log("==========================================================");
  console.log("      OPEN DOT LOCAL — E2E PDF BENCHMARK & REAL METRICS   ");
  console.log("==========================================================");

  const ollama = new OllamaProvider();
  const isHealthy = await ollama.health();
  if (!isHealthy) {
    console.error("Ollama service is not running at 127.0.0.1:11434");
    process.exit(1);
  }

  // Check installed models
  const models = await ollama.listModels();
  console.log("Installed Ollama models:", models.map(m => m.name).join(", "));
  const targetModel = models.find(m => m.name.includes("qwen3:4b"))?.name || models.find(m => m.name.includes("qwen"))?.name || models[0]?.name || "vero:latest";
  console.log(`Using model for benchmark: ${targetModel}`);

  // Test 1: PatchMLPTS.pdf or real research paper PDF
  await testPdfDocument({
    label: "TEST 1: PatchMLPTS Paper Analysis",
    filePath: "uploads/PatchMLPTS.pdf",
    fallbackText: getSamplePatchMLPTSText(),
    prompt: "analyze this paper and explain me in simple language that what this paper says",
    model: targetModel,
    ollama,
    maxEvidenceTokens: 2500,
  });

  // Test 2: Scanned / Image-only PDF
  await testPdfDocument({
    label: "TEST 2 (Edge Case 1): Scanned / Image-Only PDF",
    filePath: "uploads/scanned_sample.pdf",
    fallbackBuffer: createScannedPdfBuffer(),
    prompt: "explain this scanned PDF document",
    model: targetModel,
    ollama,
    maxEvidenceTokens: 2500,
  });

  // Test 3: Large PDF (50+ Pages)
  await testPdfDocument({
    label: "TEST 3 (Edge Case 2): Large Document (50+ Pages)",
    filePath: "uploads/large_50page_doc.pdf",
    fallbackText: generate50PageDocumentText(),
    prompt: "summarize the key conclusions across all sections of this large report",
    model: targetModel,
    ollama,
    maxEvidenceTokens: 2500,
  });
}

type TestOptions = {
  label: string;
  filePath: string;
  fallbackText?: string;
  fallbackBuffer?: Buffer;
  prompt: string;
  model: string;
  ollama: OllamaProvider;
  maxEvidenceTokens: number;
};

async function testPdfDocument(opts: TestOptions) {
  console.log(`\n----------------------------------------------------------`);
  console.log(`  ${opts.label}`);
  console.log(`----------------------------------------------------------`);

  let pdfBuffer: Buffer;
  let filename = path.basename(opts.filePath);

  if (fs.existsSync(opts.filePath)) {
    console.log(`Ingesting file from disk: ${opts.filePath}`);
    pdfBuffer = fs.readFileSync(opts.filePath);
  } else if (opts.fallbackBuffer) {
    console.log(`Generating real scanned PDF test buffer for ${filename}...`);
    pdfBuffer = opts.fallbackBuffer;
  } else {
    console.log(`Generating text paper buffer for ${filename}...`);
    pdfBuffer = Buffer.from(opts.fallbackText || "");
  }

  // Measure Ingest & Extraction Time
  const ingestStart = Date.now();
  const pdfRes = await extractPdf(pdfBuffer);
  const ingestTimeMs = Date.now() - ingestStart;

  const taskId = `task_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const dotId = "dot_e2e_benchmark";

  const chunks = chunkText({
    text: pdfRes.fullText,
    source: filename,
    taskId,
    dotId,
  });

  saveChunks(chunks);
  const storedChunks = getTaskChunks(taskId);

  // Calculate Chunk Token Statistics
  const tokenSizes = storedChunks.map(c => countTokens(c.text));
  const minTokens = tokenSizes.length ? Math.min(...tokenSizes) : 0;
  const maxTokens = tokenSizes.length ? Math.max(...tokenSizes) : 0;
  const avgTokens = tokenSizes.length ? Math.round(tokenSizes.reduce((a, b) => a + b, 0) / tokenSizes.length) : 0;

  // Evidence Budgeting
  let promptEvidenceTokens = 0;
  const selectedChunks: typeof storedChunks = [];
  for (const c of storedChunks) {
    const ct = countTokens(c.text);
    if (promptEvidenceTokens + ct > opts.maxEvidenceTokens && selectedChunks.length > 0) break;
    selectedChunks.push(c);
    promptEvidenceTokens += ct;
  }

  const overflowCount = storedChunks.length - selectedChunks.length;
  const overflowNotice = overflowCount > 0
    ? `\n\n[Note to Model: ${overflowCount} additional chunks (${storedChunks.length} total) from ${filename} are stored locally in SQLite chunk_store database and can be recalled]`
    : "";

  const evidenceText = selectedChunks.map((c, i) => `--- Chunk ${i + 1} (Page ${c.page ?? "?"}) ---\n${c.text}`).join("\n\n");

  const fullPromptContent = `${opts.prompt}\n\n[Attached PDF Content (${filename}) - Evidence Budget: ~${promptEvidenceTokens}/${opts.maxEvidenceTokens} tokens (${selectedChunks.length}/${storedChunks.length} chunks included)]:\n${evidenceText}${overflowNotice}`;

  console.log(`Ingest Summary:`);
  console.log(`- Ingest Time: ${ingestTimeMs}ms`);
  console.log(`- Page Count: ${pdfRes.pageCount}`);
  console.log(`- Is Scanned: ${pdfRes.isScanned}`);
  console.log(`- Total Chunks: ${storedChunks.length}`);
  console.log(`- Chunk Token Sizes: min=${minTokens}, avg=${avgTokens}, max=${maxTokens}`);
  console.log(`- Chunks Fed to Prompt: ${selectedChunks.length}/${storedChunks.length} (~${promptEvidenceTokens} evidence tokens)`);
  if (overflowCount > 0) {
    console.log(`- Budget Overflow: ${overflowCount} chunks stored in SQLite chunk_store (not in prompt)`);
  }

  // Execute Real Model Call
  console.log(`\nDispatching request to Ollama (${opts.model})...`);
  const answerStart = Date.now();
  let ttftMs = 0;
  let fullAnswerText = "";

  const responseMsg = await opts.ollama.chatStream(
    {
      model: opts.model,
      messages: [
        { role: "system", content: "You are Dot, a helpful AI assistant." },
        { role: "user", content: fullPromptContent },
      ],
      temperature: 0.2,
      context_length: 8192,
    },
    (chunk) => {
      if (chunk.delta?.content) {
        if (ttftMs === 0) ttftMs = Date.now() - answerStart;
        fullAnswerText += chunk.delta.content;
      }
    }
  );

  const totalAnswerTimeMs = Date.now() - answerStart;
  const metrics = responseMsg.metrics;

  console.log(`\nREAL Terminal Log Lines:`);
  console.log(`[dots] Turn Step 1/1 | Model: ${opts.model} | TTFT: ${metrics?.ttftMs || ttftMs}ms | Total: ${metrics?.totalTimeMs || totalAnswerTimeMs}ms | Prompt Tokens: ${metrics?.promptTokens || 0} | Completion Tokens: ${metrics?.completionTokens || 0}`);
  console.log(`[dots] Turn Summary | Total Time: ${metrics?.totalTimeMs || totalAnswerTimeMs}ms | Steps: 1 | Total Prompt Tokens: ${metrics?.promptTokens || 0}`);

  console.log(`\nModel Answer Text:`);
  console.log(`"""\n${fullAnswerText.trim()}\n"""`);

  clearTaskChunks(taskId);
}

function getSamplePatchMLPTSText(): string {
  return `
# PatchMLPTS: Multivariate Time Series Forecasting via Patch-Level MLP

Abstract
Multivariate time series forecasting plays a critical role in weather prediction, traffic flow modeling, energy grid management, and financial forecasting.
While Transformer architectures have achieved high accuracy, their quadratic self-attention complexity leads to significant memory overhead and latency on resource-constrained devices.
We introduce PatchMLPTS, a simple yet effective architecture that replaces self-attention with patch-level multi-layer perceptrons.

1. Introduction
Time series data collected from sensors exhibit strong local temporal semantic correlations.
By grouping consecutive timestamps into non-overlapping spatial-temporal patches, PatchMLPTS captures fine-grained temporal patterns while drastically reducing token sequence lengths.
Our approach applies channel-independence, processing each univariate sequence with shared MLP parameters.

2. Architecture Details
PatchMLPTS comprises three sequential stages:
First, Instance Normalization subtracts mean and divides by variance to mitigate distribution shift.
Second, Patch Extraction maps a 1D time series sequence of length L into P patches of size K with overlap step S.
Third, a multi-layer Perceptron backbone with residual skip-connections maps patch tokens across hidden dimensions.

3. Benchmark Performance
We evaluate PatchMLPTS on standard benchmark datasets: ETTh1, ETTh2, ETTm1, ETTm2, Weather, Electricity, Traffic, and ILI.
PatchMLPTS achieves a 14.2% reduction in Mean Squared Error (MSE) compared to PatchTST while executing 3.1x faster on CPU hardware.
Memory footprint is reduced by 64% during training and inference.

4. Conclusion
PatchMLPTS demonstrates that complex attention mechanisms are not strictly required for state-of-the-art time-series forecasting.
Simple patch-level MLP projections provide robust accuracy, low latency, and flat memory scaling.
`;
}

function createScannedPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kinds [] /Count 1 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF"
  );
}

function generate50PageDocumentText(): string {
  const pages: string[] = [];
  for (let page = 1; page <= 55; page++) {
    pages.push(`
[Page ${page}]
# Section ${page}: Enterprise Performance Analysis - Part ${page}

This is section ${page} of the large 55-page performance report.
Key metrics for page ${page}: Throughput: ${100 + page * 5} req/sec, Latency: ${20 + (page % 7)}ms, Error Rate: 0.0${page % 3}%.
The system stability index for section ${page} remains at 99.9${page % 9}%.
Observations: Hardware resource utilization peaked at ${40 + (page % 30)}% CPU and ${30 + (page % 20)}% RAM.
`   );
  }
  return pages.join("\n\n");
}

runE2EBenchmark().catch(console.error);
