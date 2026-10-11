# OpenDot-local Context Engine Benchmark

Measures whether the local context engine (BM25 + chunk store) helps a small local model answer questions about long web pages, compared with simply clipping the page.

| Condition | What the model gets |
|---|---|
| `off-short` | page text clipped to 4,000 characters |
| `off-long` | page text clipped to 12,000 characters |
| `on` | context engine active (retrieves the relevant chunks) |

## What the pages look like

Pages are built by `fixtures/build.ts`: varied, realistic prose with **no digits in the filler**, near-miss distractors (a sister plant with a different capacity, an older product with a different price) and every answer placed at a controlled depth:

- **early** (inside the 4,000-char clip), **mid** (between 4,000 and 12,000), **deep** (beyond 12,000), plus **split** facts, short pages, prompt-injection pages and one unanswerable question.

The build fails if filler contains an expected answer or a fact lands outside its bucket. The runner refuses to start if a page does not contain the answer to its own question.

## Rules the runner enforces

- Only loopback traffic is allowed. Any other host is blocked and counted (`Blocked web attempts`).
- Conditions are interleaved per question and run, so thermal or load drift hits all three equally.
- Harness failures (empty answer, raw tool call printed as text, timeout) are retried, not scored as model failures.
- Refuses to run if `DOTS_CONTEXT_ENGINE` is not read anywhere in `src/`.
- Prompt and completion tokens come from Ollama's usage counters.
- The fixture server serves pages only, never the answer-position files.

## Run it (in this order)

```bash
npx tsx bench/score.test.ts            # scorer tests
npx tsx bench/fixtures/build.ts        # build + verify fixtures

pnpm bench --only 1 --diag             # 1 question x 3 conditions, dumps what the model saw
pnpm bench --only 1,3,5,16 --runs 1    # smoke test
pnpm bench --runs 3                    # full run (60 runs per condition)
```

Results go to `bench/results/latest.md` and `bench/results/<date>-benchmark.json`.

## How to read the result

- If the Wilson intervals of two conditions overlap, **do not claim a difference**.
- Look at the **by-bucket** table. The context engine should not matter for `early` questions. It should win on `deep` questions, where the clipped baselines cannot see the fact. If it does not, the engine is not doing its job on that path.
- Publish the table with the intervals, the model, your GPU and the date. Runs of the same question are not independent, so treat borderline gaps as inconclusive.

## Contributing results

Copy your JSON into `bench/results/community/<your-gpu>-<model>.json` and open a pull request.
