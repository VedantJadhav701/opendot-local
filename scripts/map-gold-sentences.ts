import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";
import { saveChunks, getTaskChunks, clearTaskChunks } from "../src/server/context/db";

async function main() {
  console.log("=== Mapping Gold Sentences and Gold Chunk IDs ===");

  const patchPath = fs.existsSync("C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf")
    ? "C:\\Users\\HP\\Downloads\\PatchMLPTS.pdf"
    : path.join("uploads", "PatchMLPTS.pdf");
  const clipPath = path.join("uploads", "large_30page_doc.pdf");

  // Ingest PatchMLPTS.pdf
  const patchBuf = fs.readFileSync(patchPath);
  const patchExt = await extractPdf(patchBuf);
  clearTaskChunks("task_gold_patch");
  saveChunks(chunkText({ text: patchExt.fullText, source: "PatchMLPTS.pdf", taskId: "task_gold_patch", dotId: "d1" }));
  const patchChunks = getTaskChunks("task_gold_patch");

  // Ingest CLIP paper
  const clipBuf = fs.readFileSync(clipPath);
  const clipExt = await extractPdf(clipBuf);
  clearTaskChunks("task_gold_clip");
  saveChunks(chunkText({ text: clipExt.fullText, source: "large_48page_doc.pdf", taskId: "task_gold_clip", dotId: "d2" }));
  const clipChunks = getTaskChunks("task_gold_clip");

  console.log(`PatchMLPTS.pdf: ${patchChunks.length} chunks.`);
  console.log(`large_48page_doc.pdf (CLIP): ${clipChunks.length} chunks.`);

  // Define 30 Questions with exact Gold Answer Sentences from the PDF text
  const questionsData = [
    // --- PatchMLPTS.pdf (20 Questions) ---
    {
      id: "patch_q01",
      doc: "PatchMLPTS.pdf",
      question: "Who is the author of Patch-MLP-TS and what is their affiliation?",
      goldSentence: "Vedant Jadhav, Department of Artificial Intelligence and Machine Learning, Pimpri Chinchwad University, Pune, India",
    },
    {
      id: "patch_q02",
      doc: "PatchMLPTS.pdf",
      question: "What baseline models are compared against Patch-MLP-TS?",
      goldSentence: "PatchTST, DLinear, LTSF-Linear, Informer, Autoformer, and FEDformer are among the best variants of the Transformer model successfully applying to time series data.",
    },
    {
      id: "patch_q03",
      doc: "PatchMLPTS.pdf",
      question: "What failure mode occurs in naive patch-MLP construction without positional embedding?",
      goldSentence: "without an explicit patch positional embedding and a mechanism to mix information across patches, a mean-pooled patch-MLP model is found to discard temporal order entirely and is consistently outperformed by a simpler whole-window baseline.",
    },
    {
      id: "patch_q04",
      doc: "PatchMLPTS.pdf",
      question: "What are the two MLP block types combined in Patch-MLP-TS?",
      goldSentence: "Patch-MLP-TS is presented: a channel-independent, all-MLP architecture that combines patch embedding with cross-patch (token-mixing) and per-patch (feature-mixing) MLP blocks",
    },
    {
      id: "patch_q05",
      doc: "PatchMLPTS.pdf",
      question: "How much faster is Patch-MLP-TS trained compared to PatchTST on Electricity dataset?",
      goldSentence: "competitiveness with PatchTST is demonstrated on the large-channel Electricity dataset (321 variates), with training achieved 1.5–1.8× faster and inference latency reduced by up to 1.3× in the measured settings.",
    },
    {
      id: "patch_q06",
      doc: "PatchMLPTS.pdf",
      question: "What reduction in inference latency is reported for Patch-MLP-TS?",
      goldSentence: "inference latency reduced by up to 1.3× in the measured settings.",
    },
    {
      id: "patch_q07",
      doc: "PatchMLPTS.pdf",
      question: "What is the 3-seed mean MSE across four ETT benchmarks for Patch-MLP-TS vs PatchTST and DLinear?",
      goldSentence: "competitive in mean MSE with PatchTST and DLinear on average across four ETT benchmarks (3-seed mean MSE: 0.348 vs. 0.350 for PatchTST and 0.348 for DLinear)",
    },
    {
      id: "patch_q08",
      doc: "PatchMLPTS.pdf",
      question: "Which dataset has 321 channel variates in the efficiency analysis?",
      goldSentence: "large-channel Electricity dataset (321 variates), with training achieved 1.5–1.8× faster",
    },
    {
      id: "patch_q09",
      doc: "PatchMLPTS.pdf",
      question: "What model family did Zeng et al. show outperforming Transformers on LTSF?",
      goldSentence: "a family of embarrassingly simple linear models (LTSF-Linear, including DLinear and NLinear) was shown by Zeng et al. [4] to outperform these Transformers on most standard benchmarks",
    },
    {
      id: "patch_q10",
      doc: "PatchMLPTS.pdf",
      question: "What is the stride parameter S used for in patching time series?",
      goldSentence: "Given that patching reduces sequence length by a factor of stride S while preserving local temporal structures",
    },
    {
      id: "patch_q11",
      doc: "PatchMLPTS.pdf",
      question: "Which paper introduced PatchTST for multivariate time series forecasting?",
      goldSentence: "In PatchTST [5], each univariate channel is segmented into patches and channel-independent attention is applied over patch tokens",
    },
    {
      id: "patch_q12",
      doc: "PatchMLPTS.pdf",
      question: "What is the role of channel-independence in time series models?",
      goldSentence: "channel-independence where each channel contains a single univariate time series that shares the same embedding and Transformer weights across all the series.",
    },
    {
      id: "patch_q13",
      doc: "PatchMLPTS.pdf",
      question: "What architecture spirit is Patch-MLP-TS based on?",
      goldSentence: "in the spirit of MLP-Mixer. During development, a subtle but consequential failure mode in a naive patch-plus-MLP design is identified",
    },
    {
      id: "patch_q14",
      doc: "PatchMLPTS.pdf",
      question: "What benchmark datasets belong to the ETT family?",
      goldSentence: "four ETT benchmarks (ETTh1, ETTh2, ETTm1, ETTm2)",
    },
    {
      id: "patch_q15",
      doc: "PatchMLPTS.pdf",
      question: "What happens when positional embeddings are omitted in v1?",
      goldSentence: "without an explicit patch positional embedding... a mean-pooled patch-MLP model is found to discard temporal order entirely",
    },
    {
      id: "patch_q16",
      doc: "PatchMLPTS.pdf",
      question: "What key metric measures forecasting accuracy in the paper?",
      goldSentence: "Results are reported in Mean Squared Error (MSE) and Mean Absolute Error (MAE)",
    },
    {
      id: "patch_q17",
      doc: "PatchMLPTS.pdf",
      question: "Why does patching reduce computation in Transformer attention maps?",
      goldSentence: "computation and memory usage of the attention maps are quadratically reduced given the same look-back window",
    },
    {
      id: "patch_q18",
      doc: "PatchMLPTS.pdf",
      question: "What look-back window horizons are evaluated for long-term forecasting?",
      goldSentence: "long-term time series forecasting for look-back window horizons L in {96, 192, 336, 720}",
    },
    {
      id: "patch_q19",
      doc: "PatchMLPTS.pdf",
      question: "Is Patch-MLP-TS claimed to win on every single benchmark setting?",
      goldSentence: "the settings where the method does not win are explicitly reported, so that an accurate picture is given",
    },
    {
      id: "patch_q20",
      doc: "PatchMLPTS.pdf",
      question: "What index terms describe Patch-MLP-TS?",
      goldSentence: "Index Terms—time series forecasting, multi-layer perceptron, patching, channel independence, efficient architectures",
    },

    // --- CLIP Paper (large_48page_doc.pdf) (10 Questions) ---
    {
      id: "clip_q01",
      doc: "large_48page_doc.pdf",
      question: "What is the full title of the CLIP paper by OpenAI?",
      goldSentence: "Learning Transferable Visual Models From Natural Language Supervision",
    },
    {
      id: "clip_q02",
      doc: "large_48page_doc.pdf",
      question: "How many (image, text) pairs were collected from the internet to train CLIP?",
      goldSentence: "we create a new dataset of 400 million (image, text) pairs collected from the internet.",
    },
    {
      id: "clip_q03",
      doc: "large_48page_doc.pdf",
      question: "Which baseline vision architecture performance does CLIP match zero-shot on ImageNet?",
      goldSentence: "matches the performance of the original ResNet-50 on ImageNet zero-shot without using any of the 1.28 million training examples",
    },
    {
      id: "clip_q04",
      doc: "large_48page_doc.pdf",
      question: "How many labeled training examples from ImageNet were used during CLIP zero-shot evaluation?",
      goldSentence: "without using any of the 1.28 million training examples that it was trained on",
    },
    {
      id: "clip_q05",
      doc: "large_48page_doc.pdf",
      question: "How many downstream computer vision benchmarks were evaluated in the CLIP paper?",
      goldSentence: "We test this approach by benchmarking on over 30 different existing computer vision datasets",
    },
    {
      id: "clip_q06",
      doc: "large_48page_doc.pdf",
      question: "What key advantage does natural language supervision offer over crowd-labeled datasets?",
      goldSentence: "Learning from natural language supervision has several key advantages... it does not require crowd-labeled datasets",
    },
    {
      id: "clip_q07",
      doc: "large_48page_doc.pdf",
      question: "What visual tasks are tested in the zero-shot transfer section?",
      goldSentence: "spanning tasks such as OCR, action recognition in videos, geo-localization, and fine-grained object classification.",
    },
    {
      id: "clip_q08",
      doc: "large_48page_doc.pdf",
      question: "Where are the code and model weights for CLIP released?",
      goldSentence: "We release our code and model weights at https://github.com/OpenAI/CLIP.",
    },
    {
      id: "clip_q09",
      doc: "large_48page_doc.pdf",
      question: "What pre-training objective is used to pair images and text captions in CLIP?",
      goldSentence: "given a batch of N (image, text) pairs, CLIP is trained to predict which of the N x N possible (image, text) pairings across a batch actually occurred",
    },
    {
      id: "clip_q10",
      doc: "large_48page_doc.pdf",
      question: "Why is natural language supervision more flexible than standard fixed 1-of-N class vision models?",
      goldSentence: "Learning from natural language supervision also unlocks zero-shot transfer by allowing the model to specify tasks in text.",
    },
  ];

  // Map each question to its corresponding SQLite Chunk ID where the gold sentence lives
  const fixtureOutputQuestions = questionsData.map((q) => {
    const chunkList = q.doc === "PatchMLPTS.pdf" ? patchChunks : clipChunks;

    // Find all chunks whose text contains key phrases from gold sentence
    const matchedChunks = chunkList.filter((c) => {
      const cNorm = c.text.toLowerCase().replace(/\s+/g, " ");
      const gNorm = q.goldSentence.toLowerCase().replace(/\s+/g, " ");
      const words = gNorm.split(" ").filter((w) => w.length > 3);
      const matchCount = words.filter((w) => cNorm.includes(w)).length;
      return matchCount >= Math.min(3, words.length);
    });

    const goldChunkIds = matchedChunks.map((c) => c.id);

    return {
      id: q.id,
      doc: q.doc,
      question: q.question,
      goldSentence: q.goldSentence,
      goldChunkIds: goldChunkIds.length > 0 ? goldChunkIds : [chunkList[0].id],
      expectedKeywords: q.goldSentence.split(/[\s,.-]+/).filter((w) => w.length > 4).slice(0, 4),
    };
  });

  const fixtureFileContent = {
    description: "Step 2b evaluation fixture with human-readable gold sentences and gold chunk IDs",
    questions: fixtureOutputQuestions,
  };

  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "context-eval-fixture.json");
  fs.writeFileSync(fixturePath, JSON.stringify(fixtureFileContent, null, 2), "utf8");
  console.log(`Saved updated fixture to ${fixturePath}`);
}

main().catch(console.error);
