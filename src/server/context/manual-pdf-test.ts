import Module from "node:module";
const origLoad = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  if (req === "server-only") return {};
  return origLoad.apply(this, arguments);
};

import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "./pdf";
import { chunkText } from "./chunker";
import { saveChunks, getTaskChunks } from "./db";

async function runManualPdfTest() {
  console.log("=== Running Manual PDF Extraction & Chunking Test ===");

  const samplePaper = `
# PatchMLPTS: Multivariate Time Series Forecasting via Patch-Level MLP

## Abstract
Multivariate time series forecasting plays a critical role in weather prediction, traffic flow modeling, and financial market analysis. 
We propose PatchMLPTS, a lightweight patch-based multi-layer perceptron architecture designed for ultra-fast time series modeling.

## 1. Introduction
Traditional Transformer-based time series models suffer from high memory overhead and quadratic O(N^2) complexity.
PatchMLPTS segments raw series into non-overlapping spatial-temporal patches, mapping local windows into compact feature representations.

## 2. Model Architecture
PatchMLPTS consists of three core components:
1. Instance Normalization: Standardizes input mean and variance across channels.
2. Patch Extraction: Converts a length-L sequence into P patches of size K.
3. MLP Backbone: Operates independently across patch tokens and time channels.

## 3. Experimental Evaluation
We evaluate PatchMLPTS on eight benchmark datasets including ETTh1, ETTh2, ETTm1, ETTm2, Weather, Electricity, Traffic, and ILI.
PatchMLPTS achieves a 14% reduction in Mean Squared Error (MSE) compared to PatchTST while executing 3x faster on CPU/GPU.

## 4. Conclusion
PatchMLPTS provides a fast, effective baseline for time-series forecasting without complex attention matrices.
`;

  const taskId = "task_manual_test_patchmlpts";
  const dotId = "dot_manual_test";
  const filename = "PatchMLPTS.pdf";

  // Test chunker & DB store directly
  const chunks = chunkText({
    text: samplePaper,
    source: filename,
    page: 1,
    taskId,
    dotId,
  });

  saveChunks(chunks);
  const storedChunks = getTaskChunks(taskId);

  console.log(`✓ Chunker produced ${chunks.length} chunk(s) from paper text.`);
  console.log(`✓ Saved & retrieved ${storedChunks.length} chunk(s) from SQLite chunk_store.`);

  console.log("\nChunk Breakdown:");
  storedChunks.forEach((c, idx) => {
    console.log(`[Chunk ${idx + 1}] ID: ${c.id} | Page: ${c.page ?? 1} | Length: ${c.text.length} chars | Status: ${c.status} | Hash: ${c.contentHash.slice(0, 8)}...`);
    console.log(`Preview: "${c.text.slice(0, 120)}..."\n`);
  });

  console.log("=== Manual PDF Extraction & Chunking Test Complete ===");
}

runManualPdfTest().catch(console.error);
