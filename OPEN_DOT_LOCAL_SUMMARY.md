# 🚀 Open Dot Local — Architecture, Progress & SLM Optimization Report

> **Goal**: Transform Open Dot into a 100% free, local-first, cross-platform (Windows & macOS) desktop agent powered by local Ollama Small Language Models (SLMs), with zero reliance on paid cloud inference (OpenAI/E2B/Composio).

---

## 📌 1. What Has Been Completed So Far

### 1.1 Local Ollama Provider & Independent Agent Runtime (`src/server/llm/` & `src/server/agent/`)
- **Native Ollama Provider**: Implemented `OllamaProvider` supporting Ollama's REST API (`/api/tags` and `/api/chat`) with real-time token streaming and function tool calling.
- **Provider-Independent Runtime**: Decoupled `runtime.ts` from OpenAI SDK types (`responses.create`). Created standard `ChatMessage` and `ToolDefinition` abstractions.
- **Dynamic Model Resolution & Fallback**: `registry.ts` queries locally installed models via Ollama. If a selected model tag is missing, it gracefully falls back to available installed models to prevent `404 model not found` crashes.
- **Local Security Reviewer**: Refactored `review.ts` so action policy rule checks use the local Ollama reviewer model instead of OpenAI.
- **Auto-Titling**: Refactored `titles.ts` to generate chat titles using local Ollama models.

### 1.2 Cross-Platform Shell Execution (`src/server/computer/platform/`)
- **Windows Runner**: Created `windows.ts` using native PowerShell (`powershell.exe -NoProfile -ExecutionPolicy Bypass`) with non-interactive execution and workspace isolation.
- **POSIX/macOS Runner**: Created `macos.ts` using native `zsh`/`bash`.
- **Platform Router**: Created `platform/index.ts` to dynamically delegate shell execution based on `process.platform`.

### 1.3 Native OS Encryption & Local Vault (`src/server/secrets/`)
- **Windows DPAPI**: Created `store.ts` using Windows Data Protection API (`System.Security.Cryptography.ProtectedData`) to encrypt passwords and tokens locally.
- **macOS Keychain**: Integrated macOS `security` generic password vault.

### 1.4 Redesigned Settings & UI (`src/components/SettingsView.tsx`)
- Updated Settings to display Ollama connection status (`http://127.0.0.1:11434`), local model pickers, local sandbox engine details (PowerShell / zsh / Docker), and local password security.

### 1.5 Cross-Platform Desktop Packaging (`electron/` & `scripts/`)
- Updated `electron/main.mjs` for Windows and macOS compatibility.
- Converted `scripts/desktop-prepare.mjs` and `scripts/desktop-after-pack.mjs` from POSIX `cp -RP` commands to native Node.js `fs.cpSync` for seamless cross-platform packaging.
- Configured `package.json` for Windows NSIS (`.exe`) and macOS DMG (`.dmg`) installers.
- Removed paid cloud dependencies (`openai`, `@e2b/desktop`).

### 1.6 Performance & Context Optimizations
- **Context Window (`num_ctx`)**: Configured Ollama payload options to specify `num_ctx: 8192` (overriding Ollama's 2,048 token default).
- **DOM Text Clipping**: Reduced `readPage` DOM text limit from 15,000 to 4,000 characters to prevent prompt bloat.
- **History Bounding**: Capped `rebuildContextMessages` to 15 turns and 2,500 characters per message.
- **Direct Prompt Guidance**: Updated system prompt instructions in `prompt.ts` so SLMs provide direct responses immediately after reading web pages rather than looping endlessly.

### 1.7 Repository Status
- Codebase committed and pushed to **`https://github.com/VedantJadhav701/open-dot-local.git`** on branch `main`.

---

## 🤖 2. Capabilities & Strengths of Small Language Models (SLMs)

When running models in the **1.5B to 7B parameter range** (e.g., `qwen2.5:1.5b`, `llama3.2:3b`, `qwen2.5:7b`, `mistral:7b`):

### What SLMs Can Do Great (Fast & Reliable):
1. **Tool Calling & Structured Output**: Modern SLMs (especially Qwen 2.5 and Llama 3.2) excel at JSON function calling when given clear, concise tool schemas.
2. **Web Page Summarization**: Extracting key facts, key takeaways, and bullet points from fetched HTML/Markdown text.
3. **Local Shell & File Operations**: Translating natural language commands into standard terminal commands (e.g., `git`, `npm`, `python`, file reading/writing).
4. **Single-Turn & Multi-Turn Tasks**: Answering questions, summarizing documents, and following step-by-step instructions.

### Where SLMs Require Optimization:
1. **Large Prompt Overhead**: Processing 5,000+ tokens of system prompt + tool definitions on local CPU/GPU slows down token generation.
2. **Deep Reasoning Loops**: If system prompts are vague, SLMs may enter repetitive browsing/clicking loops instead of stopping to answer.

---

## ⚡ 3. Solving the 15-Minute Latency Issue: Actionable Solutions

In your test query (`browse for the website blog and explain me the blog: https://vedantjadhav.hashnode.dev/amd-llm-lab`), `qwen3:4b` took ~15 minutes because:
- The agent visited 3 consecutive web pages (Hashnode, Vercel app, GitHub repo).
- Cumulative prompt size swelled past 10,000 tokens.
- On CPU-only inference without GPU offloading, computing prompt prefill on 10k tokens takes several minutes.

### 🚀 Recommended Fixes to Get 5–10 Second Responses:

#### 1. Hardware & Ollama Acceleration
- **Enable GPU Layers**: Ensure Ollama is utilizing your GPU (NVIDIA CUDA / AMD ROCm / Apple Metal). Run `ollama ps` while running a query to verify GPU offload percentage.
- **Ollama Threads**: Set `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_ORIGINS="*"`.

#### 2. Select the Optimal Model for Speed
- For fast CPU execution, use **1.5B to 3B quantized models**:
  ```bash
  ollama pull qwen2.5:1.5b
  # or
  ollama pull llama3.2:3b
  ```
- Quantization level `q4_k_m` offers the best speed-to-accuracy ratio.

#### 3. Strict Prompt & Context Limits (Already Configured in Code)
- `readPage` text is now clipped to 4,000 characters.
- System prompt instructs the model to answer immediately after fetching web text.
- Context history is capped at 15 turns.

---

## ❓ Context & Questions for Claude / Reviewers

> **For Claude**:
> "We have transformed Open Dot into **Open Dot Local** — a local-first desktop agent running on Windows & macOS powered by Ollama SLMs (`qwen2.5:1.5b`, `llama3.2:3b`, `qwen2.5:7b`). We replaced paid OpenAI & E2B dependencies with a native Ollama provider, cross-platform PowerShell/zsh shell execution, local SQLite storage, DPAPI/Keychain secret encryption, and Playwright browser control.
>
> We want to make sure the agent executes local tasks in under **10 seconds per turn** while maintaining reliable tool-calling accuracy. Please review our architecture and suggest any further optimizations for prompt engineering, local context management, or SLM tool execution!"
