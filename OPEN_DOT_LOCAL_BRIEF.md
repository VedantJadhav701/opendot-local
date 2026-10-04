# Open Dot Local — Optimization & Loop Prevention Brief

## Real Root Cause Analysis
The 15-minute execution time was caused by an autonomous loop in the agent runtime:
- User provided 1 URL.
- Agent autonomously clicked links to Vercel app, GitHub repos, subpaths, and even `http://127.0.0.1:8000/`.
- Same URLs were read 2-3 times repeatedly.
- The step limit was set to 60 steps without answering.
- 4,000 chars x 60 results overflowed `num_ctx: 8192`. Context truncation caused the model to lose track of previous reads, triggering repeated page reads in a self-feeding loop.

---

## Targeted Fixes (Order of Impact)

1. **Hard Step Cap Per Turn**: Reduce `MAX_STEPS` from 60 to **6**. Force the model to stop and summarize after reading.
2. **Visited URL Tracking & Deduplication**: Maintain a set of visited URLs per dot session. If a URL is requested again, return a cached summary / "already visited" status.
3. **Strict URL Restrictions & Localhost Guard**:
   - Only visit user-provided URLs unless the prompt explicitly requests exploration.
   - Block `localhost` / `127.0.0.1` / private IP ranges in `open_url` unless explicitly provided by the user.
4. **Disable Qwen3 "think" Token Bloat**: Pass `"think": false` in Ollama `/api/chat` requests to prevent token waste on deep internal reasoning blocks.
5. **Prompt Caching & Keep-Alive**: Ensure system prompt and tool definitions remain byte-identical across turns so Ollama's prompt cache hits. Set `keep_alive: "30m"`.
6. **Tool Output Compression**: Extract main article content and cap tool output size.
7. **Tool Routing Optimization**: Prevent triggering generic computer actions when simple page reading is requested.

---

## Success Criteria
- Same query: **1 read**, **1 concise answer**, **0 extra links**.
- One-page task completed in **< 30-60 seconds** with fast streaming first token.
