import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText, countTokens } from "../src/server/context/chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "../src/server/context/db";
import { filterChunks } from "../src/server/context/filter";

type QuestionFixture = {
  id: string;
  doc: string;
  question: string;
  expectedKeywords: string[];
};

type FixtureFile = {
  description: string;
  questions: QuestionFixture[];
};

type QuestionEvalResult = {
  id: string;
  doc: string;
  question: string;
  goldChunkCount: number;
  baseline: {
    selectedCount: number;
    tokensFed: number;
    bytesFed: number;
    goldRecall: number;
  };
  filter10: {
    selectedCount: number;
    tokensFed: number;
    goldRecall: number;
    filterTimeMs: number;
  };
  filter20: {
    selectedCount: number;
    tokensFed: number;
    goldRecall: number;
    filterTimeMs: number;
  };
  filter30: {
    selectedCount: number;
    tokensFed: number;
    goldRecall: number;
    filterTimeMs: number;
  };
  filter2500Cap: {
    selectedCount: number;
    tokensFed: number;
    goldRecall: number;
    filterTimeMs: number;
  };
};

async function loadAndPrepareDoc(docName: string, filePath: string, taskId: string) {
  console.log(`Ingesting ${docName} (${filePath})...`);
  const buf = fs.readFileSync(filePath);
  const extract = await extractPdf(buf);

  clearTaskChunks(taskId);

  const rawChunks = chunkText({
    text: extract.fullText,
    source: docName,
    taskId,
    dotId: `dot_${taskId}`,
  });

  saveChunks(rawChunks);
  const storedChunks = getTaskChunks(taskId);
  console.log(`Loaded ${docName}: ${extract.pageCount} pages, ${storedChunks.length} chunks in SQLite DB.`);
  return storedChunks;
}

async function main() {
  console.log("=== Step 2 Context Filter Evaluation Harness ===");

  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "context-eval-fixture.json");
  const fixtureData: FixtureFile = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  // 1. Prepare documents
  const patchPath = fs.existsSync("C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf")
    ? "C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf"
    : path.join("uploads", "PatchMLPTS.pdf");

  const clipPath = path.join("uploads", "large_30page_doc.pdf");

  const patchChunks = await loadAndPrepareDoc("PatchMLPTS.pdf", patchPath, "task_eval_patch");
  const clipChunks = await loadAndPrepareDoc("large_30page_doc.pdf", clipPath, "task_eval_clip");

  const chunkMap = new Map<string, typeof patchChunks>();
  chunkMap.set("PatchMLPTS.pdf", patchChunks);
  chunkMap.set("large_30page_doc.pdf", clipChunks);

  const evalResults: QuestionEvalResult[] = [];

  for (const q of fixtureData.questions) {
    const chunks = chunkMap.get(q.doc) || [];
    const validChunks = chunks.filter((c) => c.status !== "dropped" && c.status !== "flagged");

    // Identify Gold Chunks (chunks containing any expected keyword)
    const goldChunks = validChunks.filter((c) =>
      q.expectedKeywords.some((kw) => c.text.toLowerCase().includes(kw.toLowerCase()))
    );

    const goldSet = new Set(goldChunks.map((c) => c.id));
    const totalGold = goldChunks.length || 1; // avoid div by 0

    // 1. Baseline Selection (First N chunks under 2500 token budget)
    let baselineChunks: typeof chunks = [];
    let baselineTokens = 0;
    for (const c of validChunks) {
      const t = countTokens(c.text);
      if (baselineTokens + t <= 2500) {
        baselineChunks.push(c);
        baselineTokens += t;
      } else {
        break;
      }
    }
    const baselineHits = baselineChunks.filter((c) => goldSet.has(c.id)).length;
    const baselineRecall = (baselineHits / totalGold) * 100;
    const baselineBytes = baselineChunks.reduce((acc, c) => acc + Buffer.byteLength(c.text, "utf8"), 0);

    // 2. BM25 Filter at 10%
    const f10 = filterChunks(q.question, validChunks, { topPercent: 0.10, maxEvidenceTokens: 100000 });
    const f10Hits = f10.selectedChunks.filter((c) => goldSet.has(c.id)).length;
    const f10Recall = (f10Hits / totalGold) * 100;

    // 3. BM25 Filter at 20%
    const f20 = filterChunks(q.question, validChunks, { topPercent: 0.20, maxEvidenceTokens: 100000 });
    const f20Hits = f20.selectedChunks.filter((c) => goldSet.has(c.id)).length;
    const f20Recall = (f20Hits / totalGold) * 100;

    // 4. BM25 Filter at 30%
    const f30 = filterChunks(q.question, validChunks, { topPercent: 0.30, maxEvidenceTokens: 100000 });
    const f30Hits = f30.selectedChunks.filter((c) => goldSet.has(c.id)).length;
    const f30Recall = (f30Hits / totalGold) * 100;

    // 5. BM25 Filter under 2500 Token Budget Cap
    const fCap = filterChunks(q.question, validChunks, { topPercent: 0.30, maxEvidenceTokens: 2500 });
    const fCapHits = fCap.selectedChunks.filter((c) => goldSet.has(c.id)).length;
    const fCapRecall = (fCapHits / totalGold) * 100;

    evalResults.push({
      id: q.id,
      doc: q.doc,
      question: q.question,
      goldChunkCount: goldChunks.length,
      baseline: {
        selectedCount: baselineChunks.length,
        tokensFed: baselineTokens,
        bytesFed: baselineBytes,
        goldRecall: parseFloat(baselineRecall.toFixed(1)),
      },
      filter10: {
        selectedCount: f10.selectedChunks.length,
        tokensFed: f10.totalTokens,
        goldRecall: parseFloat(f10Recall.toFixed(1)),
        filterTimeMs: f10.filterTimeMs,
      },
      filter20: {
        selectedCount: f20.selectedChunks.length,
        tokensFed: f20.totalTokens,
        goldRecall: parseFloat(f20Recall.toFixed(1)),
        filterTimeMs: f20.filterTimeMs,
      },
      filter30: {
        selectedCount: f30.selectedChunks.length,
        tokensFed: f30.totalTokens,
        goldRecall: parseFloat(f30Recall.toFixed(1)),
        filterTimeMs: f30.filterTimeMs,
      },
      filter2500Cap: {
        selectedCount: fCap.selectedChunks.length,
        tokensFed: fCap.totalTokens,
        goldRecall: parseFloat(fCapRecall.toFixed(1)),
        filterTimeMs: fCap.filterTimeMs,
      },
    });
  }

  // Calculate Average Summary Metrics across all 30 questions
  const patchEvals = evalResults.filter((r) => r.doc === "PatchMLPTS.pdf");
  const clipEvals = evalResults.filter((r) => r.doc === "large_30page_doc.pdf");

  const avgMetric = (arr: QuestionEvalResult[], fn: (r: QuestionEvalResult) => number) =>
    (arr.reduce((sum, r) => sum + fn(r), 0) / arr.length).toFixed(1);

  const summary = {
    patchMLPTS: {
      questionCount: patchEvals.length,
      avgBaselineRecall: avgMetric(patchEvals, (r) => r.baseline.goldRecall),
      avgFilter10Recall: avgMetric(patchEvals, (r) => r.filter10.goldRecall),
      avgFilter20Recall: avgMetric(patchEvals, (r) => r.filter20.goldRecall),
      avgFilter30Recall: avgMetric(patchEvals, (r) => r.filter30.goldRecall),
      avgFilterCapRecall: avgMetric(patchEvals, (r) => r.filter2500Cap.goldRecall),
      avgFilterTimeMs: avgMetric(patchEvals, (r) => r.filter2500Cap.filterTimeMs),
    },
    clipPaper: {
      questionCount: clipEvals.length,
      avgBaselineRecall: avgMetric(clipEvals, (r) => r.baseline.goldRecall),
      avgFilter10Recall: avgMetric(clipEvals, (r) => r.filter10.goldRecall),
      avgFilter20Recall: avgMetric(clipEvals, (r) => r.filter20.goldRecall),
      avgFilter30Recall: avgMetric(clipEvals, (r) => r.filter30.goldRecall),
      avgFilterCapRecall: avgMetric(clipEvals, (r) => r.filter2500Cap.goldRecall),
      avgFilterTimeMs: avgMetric(clipEvals, (r) => r.filter2500Cap.filterTimeMs),
    },
    overall: {
      totalQuestions: evalResults.length,
      avgBaselineRecall: avgMetric(evalResults, (r) => r.baseline.goldRecall),
      avgFilter10Recall: avgMetric(evalResults, (r) => r.filter10.goldRecall),
      avgFilter20Recall: avgMetric(evalResults, (r) => r.filter20.goldRecall),
      avgFilter30Recall: avgMetric(evalResults, (r) => r.filter30.goldRecall),
      avgFilterCapRecall: avgMetric(evalResults, (r) => r.filter2500Cap.goldRecall),
      avgFilterTimeMs: avgMetric(evalResults, (r) => r.filter2500Cap.filterTimeMs),
    },
  };

  console.log("\n================ SUMMARY METRICS ================");
  console.log(`Total Questions Evaluated: ${evalResults.length}`);
  console.log(`Baseline Avg Gold-Chunk Recall (First N under 2500 tokens): ${summary.overall.avgBaselineRecall}%`);
  console.log(`BM25 Filter 10% Cutoff Recall: ${summary.overall.avgFilter10Recall}%`);
  console.log(`BM25 Filter 20% Cutoff Recall: ${summary.overall.avgFilter20Recall}%`);
  console.log(`BM25 Filter 30% Cutoff Recall: ${summary.overall.avgFilter30Recall}%`);
  console.log(`BM25 Filter (2500 Token Cap) Recall: ${summary.overall.avgFilterCapRecall}%`);
  console.log(`Avg BM25 Filter Latency: ${summary.overall.avgFilterTimeMs} ms`);

  const outputJSON = {
    summary,
    evalResults,
  };

  const outputDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "eval-step2.json"), JSON.stringify(outputJSON, null, 2), "utf8");
  console.log(`\nEvaluation complete! Saved results to docs/raw/eval-step2.json`);
}

main().catch(console.error);
