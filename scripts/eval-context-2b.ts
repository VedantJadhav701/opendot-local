import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText, countTokens, type ChunkRecord } from "../src/server/context/chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "../src/server/context/db";
import { rankChunksBM25 } from "../src/server/context/bm25";
import { fetchEmbedding, rankChunksEmbeddings } from "../src/server/context/embed";
import { rankChunksHybrid } from "../src/server/context/hybrid";
import { expandNeighbors } from "../src/server/context/neighbors";

type QuestionFixture = {
  id: string;
  doc: string;
  page: string;
  isLate: boolean;
  question: string;
  answerSentence: string;
  keyFact: string;
  goldChunkIds: string[];
  goldPositions: number[];
};

type FixtureFile = {
  description: string;
  totalQuestions: number;
  averageGoldChunksPerQuestion: number;
  questions: QuestionFixture[];
};

type ConfigMetrics = {
  hit5: number; // 0 or 1
  hit10: number; // 0 or 1
  hit20: number; // 0 or 1
  allGoldRecall: number; // 0..100
  candidateTokens: number;
  latencyMs: number;
};

type QuestionEvalResult2b = {
  id: string;
  doc: string;
  page: string;
  isLate: boolean;
  question: string;
  answerSentence: string;
  keyFact: string;
  goldChunkCount: number;
  baseline: ConfigMetrics;
  bm25: ConfigMetrics;
  embed: ConfigMetrics;
  hybrid: ConfigMetrics;
  hybridNeighbors: ConfigMetrics;
};

type E2EResult = {
  questionId: string;
  doc: string;
  page: string;
  isLate: boolean;
  question: string;
  keyFact: string;
  baseline: {
    answer: string;
    score: number; // 1 or 0
    tokens: number;
    latencyMs: number;
  };
  bm25: {
    answer: string;
    score: number; // 1 or 0
    tokens: number;
    latencyMs: number;
  };
  hybrid: {
    answer: string;
    score: number; // 1 or 0
    tokens: number;
    latencyMs: number;
  };
};

async function prepareDocAndEmbeddings(docName: string, filePath: string, taskId: string) {
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
  console.log(`Stored ${storedChunks.length} chunks in SQLite DB for ${docName}.`);

  console.log(`Pre-computing CPU embeddings (nomic-embed-text) for ${docName}...`);
  const embedStartTime = Date.now();
  const embeddingsMap = new Map<string, number[]>();

  const validChunks = storedChunks.filter((c) => c.status !== "dropped" && c.status !== "flagged");
  for (let i = 0; i < validChunks.length; i++) {
    const chunk = validChunks[i];
    const vec = await fetchEmbedding(chunk.text);
    embeddingsMap.set(chunk.id, vec);

    if ((i + 1) % 50 === 0 || i + 1 === validChunks.length) {
      console.log(`Progress: ${i + 1}/${validChunks.length} embeddings computed.`);
    }
  }

  const totalEmbedTime = Date.now() - embedStartTime;
  const avgEmbedTime = (totalEmbedTime / validChunks.length).toFixed(1);

  console.log(`Embeddings completed for ${docName}: total ${totalEmbedTime}ms (${avgEmbedTime} ms/chunk).`);
  return { chunks: storedChunks, embeddingsMap };
}

function computeMetrics(
  rankedChunks: ChunkRecord[],
  goldSet: Set<string>,
  totalGoldCount: number,
  latencyMs: number
): ConfigMetrics {
  const top5 = rankedChunks.slice(0, 5);
  const top10 = rankedChunks.slice(0, 10);
  const top20 = rankedChunks.slice(0, 20);

  const hit5 = top5.some((c) => goldSet.has(c.id)) ? 1 : 0;
  const hit10 = top10.some((c) => goldSet.has(c.id)) ? 1 : 0;
  const hit20 = top20.some((c) => goldSet.has(c.id)) ? 1 : 0;

  const foundGoldIn20 = top20.filter((c) => goldSet.has(c.id)).length;
  const allGoldRecall = totalGoldCount > 0 ? (foundGoldIn20 / totalGoldCount) * 100 : 0;
  const candidateTokens = top20.reduce((acc, c) => acc + countTokens(c.text), 0);

  return {
    hit5,
    hit10,
    hit20,
    allGoldRecall: parseFloat(allGoldRecall.toFixed(1)),
    candidateTokens,
    latencyMs,
  };
}

export function cleanPreamble(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^(Let me|Hmm|Okay|First|Looking at|Based on the context,?\s*|To answer your question,?\s*|From the document,?\s*)+/gi, "")
    .trim();
}

async function callOllamaLLM(prompt: string): Promise<{ text: string; tokens: number; latencyMs: number }> {
  const startTime = Date.now();
  try {
    const res = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:4b",
        think: false, // Top-level think: false
        system: "Answer directly in 2-3 sentences. Do not write 'Let me analyze', 'First', 'From the document', or any preamble.",
        options: {
          num_ctx: 4096,
          num_predict: 250,
        },
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
    });

    if (!res.ok) {
      return { text: "Ollama request failed", tokens: 0, latencyMs: Date.now() - startTime };
    }

    const data = await res.json();
    const rawContent = data.message?.content || "";
    const cleaned = cleanPreamble(rawContent);
    const tokens = data.eval_count || countTokens(cleaned);

    return {
      text: cleaned,
      tokens,
      latencyMs: Date.now() - startTime,
    };
  } catch (e: any) {
    return { text: `Error: ${e.message}`, tokens: 0, latencyMs: Date.now() - startTime };
  }
}

function scoreKeyFact(answerText: string, keyFact: string): number {
  if (!keyFact) return 1;
  const aNorm = answerText.toLowerCase().replace(/[^a-z0-9\s.]/g, "");
  const kNorm = keyFact.toLowerCase().replace(/[^a-z0-9\s.]/g, "");

  // Match keyFact string or words
  if (aNorm.includes(kNorm)) return 1;
  const kWords = kNorm.split(/\s+/).filter((w) => w.length > 2);
  if (kWords.length > 0 && kWords.every((w) => aNorm.includes(w))) return 1;

  return 0;
}

async function main() {
  console.log("=== Step 2b Context Retrieval & E2E LLM Evaluation Suite (50 Questions) ===");

  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "context-eval-fixture.json");
  const fixtureData: FixtureFile = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  // 1. Prepare documents & compute nomic-embed-text embeddings
  const patchPath = fs.existsSync("C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf")
    ? "C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf"
    : path.join("uploads", "PatchMLPTS.pdf");
  const clipPath = path.join("uploads", "large_30page_doc.pdf");

  const patchData = await prepareDocAndEmbeddings("PatchMLPTS.pdf", patchPath, "task_2b_patch");
  const clipData = await prepareDocAndEmbeddings("large_48page_doc.pdf", clipPath, "task_2b_clip");

  const docMap = new Map<string, typeof patchData>();
  docMap.set("PatchMLPTS.pdf", patchData);
  docMap.set("large_48page_doc.pdf", clipData);
  docMap.set("large_30page_doc.pdf", clipData);

  const questionResults: QuestionEvalResult2b[] = [];
  const e2eResults: E2EResult[] = [];

  for (let idx = 0; idx < fixtureData.questions.length; idx++) {
    const q = fixtureData.questions[idx];
    console.log(`\n[Evaluating ${idx + 1}/50] Question ID: ${q.id} (${q.doc}, ${q.page}, isLate: ${q.isLate})`);

    const docObj = docMap.get(q.doc)!;
    const validChunks = docObj.chunks.filter((c) => c.status !== "dropped" && c.status !== "flagged");

    // Match exact gold chunk IDs from fixture
    const goldSet = new Set(q.goldChunkIds);
    const totalGold = q.goldChunkIds.length;

    // --- Config 1: Baseline (First-N) ---
    const t0 = Date.now();
    const baselineChunks = validChunks.slice(0, 20);
    const baselineMetrics = computeMetrics(baselineChunks, goldSet, totalGold, Date.now() - t0);

    // --- Config 2: BM25-only ---
    const t1 = Date.now();
    const bm25Ranked = rankChunksBM25(q.question, validChunks).map((r) => r.chunk);
    const bm25Metrics = computeMetrics(bm25Ranked, goldSet, totalGold, Date.now() - t1);

    // --- Config 3: Embed-only ---
    const t2 = Date.now();
    const embedRanked = (await rankChunksEmbeddings(q.question, validChunks, docObj.embeddingsMap)).map((r) => r.chunk);
    const embedMetrics = computeMetrics(embedRanked, goldSet, totalGold, Date.now() - t2);

    // --- Config 4: Hybrid (BM25 + Embed via RRF) ---
    const t3 = Date.now();
    const hybridRanked = (await rankChunksHybrid(q.question, validChunks, docObj.embeddingsMap, "hybrid")).map((r) => r.chunk);
    const hybridMetrics = computeMetrics(hybridRanked, goldSet, totalGold, Date.now() - t3);

    // --- Config 5: Hybrid + Neighbors ---
    const t4 = Date.now();
    const neighborChunks = expandNeighbors(hybridRanked.slice(0, 15), validChunks);
    const hybridNeighborMetrics = computeMetrics(neighborChunks, goldSet, totalGold, Date.now() - t4);

    questionResults.push({
      id: q.id,
      doc: q.doc,
      page: q.page,
      isLate: q.isLate,
      question: q.question,
      answerSentence: q.answerSentence,
      keyFact: q.keyFact,
      goldChunkCount: totalGold,
      baseline: baselineMetrics,
      bm25: bm25Metrics,
      embed: embedMetrics,
      hybrid: hybridMetrics,
      hybridNeighbors: hybridNeighborMetrics,
    });

    // --- Item 5: End-to-End LLM Pipeline Evaluation (Baseline vs BM25 vs Hybrid) ---
    // 1. Baseline Prompt Context
    const baselinePromptText = baselineChunks.slice(0, 8).map((c, i) => `[Chunk ${i + 1}]\n${c.text}`).join("\n\n");
    const baselineLLMPrompt = `Context:\n${baselinePromptText}\n\nQuestion: ${q.question}`;

    // 2. BM25 Prompt Context (up to 2500 tokens)
    const bm25Selected: ChunkRecord[] = [];
    let bm25Tok = 0;
    for (const c of bm25Ranked) {
      const tok = countTokens(c.text);
      if (bm25Tok + tok <= 2500) {
        bm25Selected.push(c);
        bm25Tok += tok;
      } else {
        break;
      }
    }
    const bm25PromptText = bm25Selected.map((c, i) => `[Chunk ${i + 1}]\n${c.text}`).join("\n\n");
    const bm25LLMPrompt = `Context:\n${bm25PromptText}\n\nQuestion: ${q.question}`;

    // 3. Hybrid Prompt Context (up to 2500 tokens)
    const hybridSelected: ChunkRecord[] = [];
    let hybridTok = 0;
    for (const c of hybridRanked) {
      const tok = countTokens(c.text);
      if (hybridTok + tok <= 2500) {
        hybridSelected.push(c);
        hybridTok += tok;
      } else {
        break;
      }
    }
    const hybridPromptText = hybridSelected.map((c, i) => `[Chunk ${i + 1}]\n${c.text}`).join("\n\n");
    const hybridLLMPrompt = `Context:\n${hybridPromptText}\n\nQuestion: ${q.question}`;

    const baselineAns = await callOllamaLLM(baselineLLMPrompt);
    const bm25Ans = await callOllamaLLM(bm25LLMPrompt);
    const hybridAns = await callOllamaLLM(hybridLLMPrompt);

    e2eResults.push({
      questionId: q.id,
      doc: q.doc,
      page: q.page,
      isLate: q.isLate,
      question: q.question,
      keyFact: q.keyFact,
      baseline: {
        answer: baselineAns.text,
        score: scoreKeyFact(baselineAns.text, q.keyFact),
        tokens: baselineAns.tokens,
        latencyMs: baselineAns.latencyMs,
      },
      bm25: {
        answer: bm25Ans.text,
        score: scoreKeyFact(bm25Ans.text, q.keyFact),
        tokens: bm25Ans.tokens,
        latencyMs: bm25Ans.latencyMs,
      },
      hybrid: {
        answer: hybridAns.text,
        score: scoreKeyFact(hybridAns.text, q.keyFact),
        tokens: hybridAns.tokens,
        latencyMs: hybridAns.latencyMs,
      },
    });
  }

  // --- Compute Summary Metrics (Overall, Early-Page, Late-Page) ---
  const earlyList = questionResults.filter((r) => !r.isLate);
  const lateList = questionResults.filter((r) => r.isLate);

  const calcHitRate = (list: QuestionEvalResult2b[], getter: (r: QuestionEvalResult2b) => number) =>
    parseFloat(((list.reduce((sum, r) => sum + getter(r), 0) / list.length) * 100).toFixed(1));

  const calcAvgVal = (list: QuestionEvalResult2b[], getter: (r: QuestionEvalResult2b) => number) =>
    parseFloat((list.reduce((sum, r) => sum + getter(r), 0) / list.length).toFixed(1));

  const calcE2EScore = (list: E2EResult[], getter: (r: E2EResult) => number) =>
    parseFloat(((list.reduce((sum, r) => sum + getter(r), 0) / list.length) * 100).toFixed(1));

  const calcE2EAvg = (list: E2EResult[], getter: (r: E2EResult) => number) =>
    parseFloat((list.reduce((sum, r) => sum + getter(r), 0) / list.length).toFixed(1));

  const earlyE2E = e2eResults.filter((r) => !r.isLate);
  const lateE2E = e2eResults.filter((r) => r.isLate);

  const summary = {
    totalQuestions: questionResults.length,
    earlyQuestionsCount: earlyList.length,
    lateQuestionsCount: lateList.length,
    retrieval: {
      overall: {
        baseline: { hit5: calcHitRate(questionResults, r => r.baseline.hit5), hit10: calcHitRate(questionResults, r => r.baseline.hit10), hit20: calcHitRate(questionResults, r => r.baseline.hit20), recall: calcAvgVal(questionResults, r => r.baseline.allGoldRecall) },
        bm25: { hit5: calcHitRate(questionResults, r => r.bm25.hit5), hit10: calcHitRate(questionResults, r => r.bm25.hit10), hit20: calcHitRate(questionResults, r => r.bm25.hit20), recall: calcAvgVal(questionResults, r => r.bm25.allGoldRecall) },
        embed: { hit5: calcHitRate(questionResults, r => r.embed.hit5), hit10: calcHitRate(questionResults, r => r.embed.hit10), hit20: calcHitRate(questionResults, r => r.embed.hit20), recall: calcAvgVal(questionResults, r => r.embed.allGoldRecall) },
        hybrid: { hit5: calcHitRate(questionResults, r => r.hybrid.hit5), hit10: calcHitRate(questionResults, r => r.hybrid.hit10), hit20: calcHitRate(questionResults, r => r.hybrid.hit20), recall: calcAvgVal(questionResults, r => r.hybrid.allGoldRecall) },
        hybridNeighbors: { hit5: calcHitRate(questionResults, r => r.hybridNeighbors.hit5), hit10: calcHitRate(questionResults, r => r.hybridNeighbors.hit10), hit20: calcHitRate(questionResults, r => r.hybridNeighbors.hit20), recall: calcAvgVal(questionResults, r => r.hybridNeighbors.allGoldRecall) },
      },
      earlyPages: {
        baseline: { hit5: calcHitRate(earlyList, r => r.baseline.hit5), hit10: calcHitRate(earlyList, r => r.baseline.hit10), hit20: calcHitRate(earlyList, r => r.baseline.hit20), recall: calcAvgVal(earlyList, r => r.baseline.allGoldRecall) },
        bm25: { hit5: calcHitRate(earlyList, r => r.bm25.hit5), hit10: calcHitRate(earlyList, r => r.bm25.hit10), hit20: calcHitRate(earlyList, r => r.bm25.hit20), recall: calcAvgVal(earlyList, r => r.bm25.allGoldRecall) },
        embed: { hit5: calcHitRate(earlyList, r => r.embed.hit5), hit10: calcHitRate(earlyList, r => r.embed.hit10), hit20: calcHitRate(earlyList, r => r.embed.hit20), recall: calcAvgVal(earlyList, r => r.embed.allGoldRecall) },
        hybrid: { hit5: calcHitRate(earlyList, r => r.hybrid.hit5), hit10: calcHitRate(earlyList, r => r.hybrid.hit10), hit20: calcHitRate(earlyList, r => r.hybrid.hit20), recall: calcAvgVal(earlyList, r => r.hybrid.allGoldRecall) },
        hybridNeighbors: { hit5: calcHitRate(earlyList, r => r.hybridNeighbors.hit5), hit10: calcHitRate(earlyList, r => r.hybridNeighbors.hit10), hit20: calcHitRate(earlyList, r => r.hybridNeighbors.hit20), recall: calcAvgVal(earlyList, r => r.hybridNeighbors.allGoldRecall) },
      },
      latePages: {
        baseline: { hit5: calcHitRate(lateList, r => r.baseline.hit5), hit10: calcHitRate(lateList, r => r.baseline.hit10), hit20: calcHitRate(lateList, r => r.baseline.hit20), recall: calcAvgVal(lateList, r => r.baseline.allGoldRecall) },
        bm25: { hit5: calcHitRate(lateList, r => r.bm25.hit5), hit10: calcHitRate(lateList, r => r.bm25.hit10), hit20: calcHitRate(lateList, r => r.bm25.hit20), recall: calcAvgVal(lateList, r => r.bm25.allGoldRecall) },
        embed: { hit5: calcHitRate(lateList, r => r.embed.hit5), hit10: calcHitRate(lateList, r => r.embed.hit10), hit20: calcHitRate(lateList, r => r.embed.hit20), recall: calcAvgVal(lateList, r => r.embed.allGoldRecall) },
        hybrid: { hit5: calcHitRate(lateList, r => r.hybrid.hit5), hit10: calcHitRate(lateList, r => r.hybrid.hit10), hit20: calcHitRate(lateList, r => r.hybrid.hit20), recall: calcAvgVal(lateList, r => r.hybrid.allGoldRecall) },
        hybridNeighbors: { hit5: calcHitRate(lateList, r => r.hybridNeighbors.hit5), hit10: calcHitRate(lateList, r => r.hybridNeighbors.hit10), hit20: calcHitRate(lateList, r => r.hybridNeighbors.hit20), recall: calcAvgVal(lateList, r => r.hybridNeighbors.allGoldRecall) },
      },
    },
    e2eSummary: {
      overall: {
        baseline: { meanScore: calcE2EScore(e2eResults, r => r.baseline.score), meanTimeMs: calcE2EAvg(e2eResults, r => r.baseline.latencyMs) },
        bm25: { meanScore: calcE2EScore(e2eResults, r => r.bm25.score), meanTimeMs: calcE2EAvg(e2eResults, r => r.bm25.latencyMs) },
        hybrid: { meanScore: calcE2EScore(e2eResults, r => r.hybrid.score), meanTimeMs: calcE2EAvg(e2eResults, r => r.hybrid.latencyMs) },
      },
      latePages: {
        baseline: { meanScore: calcE2EScore(lateE2E, r => r.baseline.score), meanTimeMs: calcE2EAvg(lateE2E, r => r.baseline.latencyMs) },
        bm25: { meanScore: calcE2EScore(lateE2E, r => r.bm25.score), meanTimeMs: calcE2EAvg(lateE2E, r => r.bm25.latencyMs) },
        hybrid: { meanScore: calcE2EScore(lateE2E, r => r.hybrid.score), meanTimeMs: calcE2EAvg(lateE2E, r => r.hybrid.latencyMs) },
      },
    },
  };

  console.log("\n================ RETRIEVAL BENCHMARK SUMMARY ================");
  console.log(`Baseline Late-Page hit@20: ${summary.retrieval.latePages.baseline.hit20}% (Target: < 90%)`);
  console.log(`BM25 Late-Page hit@20: ${summary.retrieval.latePages.bm25.hit20}% | Hybrid Late-Page hit@20: ${summary.retrieval.latePages.hybrid.hit20}%`);
  console.log(`E2E Late-Page KeyFact Accuracy: Baseline = ${summary.e2eSummary.latePages.baseline.meanScore}% | BM25 = ${summary.e2eSummary.latePages.bm25.meanScore}% | Hybrid = ${summary.e2eSummary.latePages.hybrid.meanScore}%`);

  const rawDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(rawDir, { recursive: true });

  const outputJSON = { summary, questionResults };
  fs.writeFileSync(path.join(rawDir, "eval-step2b.json"), JSON.stringify(outputJSON, null, 2), "utf8");

  const jsonlLines = e2eResults.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(path.join(rawDir, "e2e-step2b.jsonl"), jsonlLines, "utf8");

  console.log(`Saved evaluation outputs to docs/raw/eval-step2b.json and docs/raw/e2e-step2b.jsonl`);
}

main().catch(console.error);
