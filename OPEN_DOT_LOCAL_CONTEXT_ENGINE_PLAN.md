# Open Dot Local — Context Engine Plan

Recursive chunk pruning with a temp store, for small local models on constrained hardware.

---

## 1. Goal

Let small local models (qwen3:4b at int4 and smaller) do work that normally needs a big context or a big model:

- Open-ended web research across many pages
- Long documents and logs
- Codebase search
- Multi-step tasks

Targets:

- Free, no API key, no cost
- Works on users with 4GB+ VRAM and 16GB+ RAM, and degrades gracefully below that
- Main model context stays small and flat (about 2 to 3k tokens of evidence) no matter how much data was fetched
- Nothing is permanently lost: dropped data stays in a local store and can be recalled

## 2. Core Principle

**The model is a stateless function. Code is the brain. State lives in SQLite, not in the context window.**

Many short calls with fresh small contexts, instead of one growing context. This avoids:

- Prefill slowdown from long prompts
- Truncation, which makes the model forget and loop (the cause of the 60-step, 15-minute run)
- VRAM overflow from large KV cache

---

## 3. Architecture

```
User task
   |
   v
Query rewriter  (1 to 3 sub-questions)
   |
   v
Fetch + chunk  (web page / file / log / code)
   |
   v
+--------------------------------------+
| TEMP STORE (SQLite)                  |
| all chunks: text, source, embedding, |
| status, score                        |
+--------------------------------------+
   |
   v
Stage 1: cheap filter (BM25 + embeddings, no LLM)
   |
   v
Stage 2: LLM relevance label (relevant / maybe / no)
   |
   v
Stage 3: deep read of survivors -> facts with chunk IDs
   |
   v
WORKING SET (about 5 to 10 chunks, in model context)
   |
   v
Answer (cites chunk IDs, verified in code)
```

### Three-tier memory

| Tier | Where | Size | Access |
|---|---|---|---|
| Working set | Model context | 5 to 10 chunks | Always visible |
| Temp store | SQLite | All fetched chunks (e.g. 50 to 500) | `recall()` search |
| Source | Web / disk | Everything | Re-fetch only if temp store misses |

---

## 4. Pipeline Stages

### Stage 0: Query rewrite
- Turn the user ask into 1 to 3 explicit sub-questions.
- Filters run per sub-question, so a vague ask does not hurt recall.
- Uses `think: false` and JSON output.

### Stage 1: Ingest and chunk
- Split on headings and paragraphs, never fixed character cuts.
- Chunk size about 200 to 400 tokens. Overlap 10 to 15%.
- Store each chunk: `id, task_id, source_url, position, text, embedding, status=pending`.
- Dedupe by URL and content hash.
- Flag chunks containing injection patterns (e.g. "ignore previous instructions") and force them to `dropped`.

### Stage 2: Cheap filter (no LLM)
- BM25 plus embedding similarity against each sub-question.
- Generous: keep the top 30%, not the top 10%.
- Threshold-based, not fixed top-k.
- Runs on CPU, near-free.

### Stage 3: LLM relevance label
- Model sees one sub-question plus a batch of 3 to 4 short chunks.
- Constrained JSON output (Ollama `format` with JSON schema).
- Coarse labels only: `relevant`, `maybe`, `no`. No 0 to 10 scores.
- Same prompt prefix every call for prompt cache hits.
- `think: false`.
- Keep `relevant`. Keep `maybe` only if the evidence budget is not yet full.

### Stage 4: Deep read
- Only survivors enter the main context.
- Model extracts facts, each tagged with chunk ID.
- Code checks every cited ID exists and the quoted text appears in that chunk.

### Stage 5: Answer
- Final answer built from extracted facts only.
- Response shows which chunks backed which claims.
- If evidence is thin, trigger widening (section 5) before answering.

### Adaptive control
Numbers like 50 to 10 to 5 are examples, not rules. Stop conditions in code:

- Enough evidence (every sub-question has at least N supporting facts), or
- Time or call budget reached, or
- Chunks exhausted

---

## 5. Recall: finding what the pipeline dropped

This is the safety net. Triggered two ways.

### 5.1 User-triggered
User says "I want specific info about X" or "what about Y?".

Lookup order:

1. **Working set** (the 5 to 10 kept chunks). Check first. Cheapest.
2. **Temp store** (all chunks for this task). Run Stage 2 plus Stage 3 again with the new query over all stored chunks, including `dropped` ones.
3. **Source re-fetch** (optional). If the temp store has nothing relevant, ask whether to fetch more pages or search again.

Found chunks get **promoted** into the working set. To stay under the context budget, the least-relevant working chunks are **demoted** back to the store (never deleted).

### 5.2 Auto-triggered
The engine widens on its own when:

- A sub-question has no supporting facts after Stage 4
- The model output says it lacks information
- Citation verification fails

Auto-widen order: re-scan `dropped` chunks with a looser threshold, then `maybe` chunks, then optionally fetch more sources. Capped at 2 widen rounds.

### 5.3 `recall(query)` tool
- Exposed to the dot as a normal tool.
- Searches the temp store (BM25 plus embeddings), returns the top chunks with IDs.
- Part of the small "research" tool pack.

---

## 6. Recursion for large inputs

When chunk count is very large (e.g. 500+):

1. Group chunks into buckets of about 50.
2. Run the full pipeline per bucket, producing a bucket summary plus its best chunks.
3. Run the pipeline again over the bucket outputs.
4. Cap depth at 2 to 3 levels in code.

---

## 7. Temp Store Design (SQLite)

```sql
CREATE TABLE chunk_store (
  id           INTEGER PRIMARY KEY,
  task_id      TEXT NOT NULL,
  dot_id       TEXT NOT NULL,
  source       TEXT,        -- URL or file path
  position     INTEGER,     -- order within source
  text         TEXT NOT NULL,
  content_hash TEXT,
  embedding    BLOB,
  status       TEXT,        -- pending | kept | maybe | dropped | flagged
  label        TEXT,        -- relevant | maybe | no
  subquestion  INTEGER,
  created_at   INTEGER
);
CREATE INDEX idx_chunk_task ON chunk_store(task_id, status);
```

Rules:

- Scoped per `task_id` and per dot, so dots do not leak data to each other.
- TTL: purge after the task ends plus N days, or on user request. Configurable.
- Only the user's own fetched content, stored locally. Never sent to any cloud.
- Embeddings: small local model (e.g. an Ollama embedding model). Fall back to BM25 only on very weak devices.

---

## 8. Safety

- **Reader/actor split.** Stages 3 and 4 run with no tools. Injected text in a chunk can at most change a label. It cannot run commands.
- **Taint tracking.** After untrusted content enters a task, any shell, file write, or credential action requires an approval card.
- **Code policy is the wall.** The model is never the final authority.
- **Citation verification** in code reduces hallucination.

---

## 9. Hardware Profiles

Detect at first-run and store in settings.

| Profile | Hardware | Model | Behavior |
|---|---|---|---|
| Standard | 4GB+ VRAM, 16GB+ RAM | qwen3:4b (int4) | Full pipeline |
| Lite | Below standard | qwen3:1.7b or 0.6b | Smaller batches, BM25-heavy, lower page budget, honest limits shown in UI |

Ollama settings to test for 4GB VRAM:

- `OLLAMA_FLASH_ATTENTION=1`
- `OLLAMA_KV_CACHE_TYPE=q8_0`
- `OLLAMA_NUM_PARALLEL=1`
- `num_ctx` 4096 to 6144
- `keep_alive` long
- `think: false` for filter, label, and extract calls. Thinking on only for a hard final step, with a token cap.

One model stays loaded and plays every role through different prompts. No model swapping.

---

## 10. Known Risks and Fixes

| Risk | Fix |
|---|---|
| Good chunk dropped early | Generous Stage 2, threshold not top-k, auto-widen, recall tool |
| Small model scores are noisy | Coarse labels, JSON schema, fixed prompt, benchmark |
| Vague query | Rewrite into sub-questions, filter per sub-question |
| Fact split across chunks | Paragraph/heading splits, 10 to 15% overlap, optionally merge neighbors of kept chunks |
| Too many LLM calls | Short chunks, batch 3 to 4 per call, `think: false`, shared prompt prefix |
| Slower than one-shot | Accept it. Time is flat and predictable. Stream progress to UI |
| Temp store grows | TTL, per-task scope, size cap |
| Embedding cost on weak CPU | BM25-only fallback in Lite profile |

---

## 11. Build Order

**Step 0: Stop the loop (do first, independent of this engine)**
- Per-turn step cap
- Visited-URL set with cached result
- Only visit user-given URLs unless asked to explore
- Block localhost/127.0.0.1 in `open_url` unless the user supplied it
- Check why "Using its computer" fires on plain reads
- `think: false` on tool turns

**Step 1: Chunk store and ingest**
- `chunk_store` table, chunker, dedupe, injection flagging

**Step 2: Stage 2 filter**
- BM25 plus embeddings, threshold logic

**Step 3: Stage 3 and 4**
- Labeler and extractor with JSON schema, citation verifier

**Step 4: Working set manager**
- Promote and demote, context budget enforcement

**Step 5: `recall()` tool and auto-widen**

**Step 6: Query rewriter**

**Step 7: Hardware profiles and Ollama settings**

**Step 8: Recursion for large inputs**

**Step 9: Reuse the engine** for file Q&A, log parsing, codebase search

**Step 10: Benchmark and publish numbers**

---

## 12. Benchmark Plan

Build before trusting any of this.

**Dataset:** about 20 questions with known answers over fixed pages and documents. Include a few vague questions and a few where the answer spans two chunks.

**Measure per stage:**

- Chunk recall: did the answer-bearing chunk survive Stage 2? Stage 3? Stage 4?
- Final answer correctness
- Citation validity rate
- Number of LLM calls
- Time to first token, and total time
- Peak VRAM and RAM

**Compare:**

- Baseline: current agent, qwen3:4b, no engine
- Engine on, qwen3:4b
- Engine on, qwen3:1.7b
- Optional: another 3B model

**Hardware:** at least one 4GB VRAM / 16GB RAM machine and one below the standard profile.

**Acceptance targets (adjust after the first run):**

- "Browse this URL and explain it" = one page read, one answer, no extra links
- No repeated reads of the same URL within a turn
- Recall of answer-bearing chunk at least 90% after Stage 2 and at least 85% after Stage 3
- Context sent to the model stays under about 3k tokens of evidence in every call
- Every cited chunk ID passes verification

Fix the leakiest stage first.

---

## 13. What to Claim Publicly

Safe:

- Free, local, no API key, no cost
- Handles multi-page research and long documents with bounded, flat context
- Dropped information is never lost and can be recalled
- Works on modest hardware, with published benchmark numbers

Avoid:

- "Matches cloud models"
- Any claim without benchmark numbers behind it

---

## 14. Open Questions for Review

1. Best chunk size and overlap for web pages on qwen3:4b?
2. Is a local embedding model worth the RAM on the Lite profile, or is BM25 enough?
3. Batch size for the labeler: 3, 4, or 6 chunks per call?
4. How should demotion pick which working chunks to evict?
5. When should the engine ask the user before re-fetching sources?
6. Should recall results be shown to the user in the UI as cited sources?
