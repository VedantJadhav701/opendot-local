# Introducing OpenDot-Local v0.2: Your 100% Private, Autonomous AI Agent Desktop Powered by Ollama

*No cloud bills. No data leaks. No API keys. Just real autonomous AI coworkers executing tasks directly on your laptop.*

---

![OpenDot-Local Dashboard](https://opendot-local.vercel.app/screenshots/app-overview.png)

## The Problem With Cloud AI Agents

Over the past year, we have seen an explosion of AI agents. But almost all of them suffer from three fundamental problems:

1. **Your Private Data Leaves Your Machine:** Every file you upload, search query you make, and document you summarize gets streamed to third-party cloud servers.
2. **Surprise API Bills:** Running multi-step autonomous workflows with cloud LLMs burns tokens fast. A handful of deep research loops or web scraping routines can cost dollars every single session.
3. **Flaky Browser Automation & Setup Headaches:** Most agent setups require complex Python virtual environments, Playwright drivers, Redis queues, and Docker containers that break at the first update.

I asked myself: **Why can't an AI agent run like a real coworker directly on my machine — private, persistent, offline-capable, and completely free?**

Today, I’m thrilled to launch **OpenDot-Local v0.2.0**.

---

## What is OpenDot-Local?

**OpenDot-Local** is a free, open-source desktop application that gives you autonomous AI coworkers ("Dots") running locally on your hardware with **Ollama**.

Each Dot has its own persistent identity, long-term memory, and tool suite:
- **Autonomous Browser Automation:** Navigates the web via local Chromium or Edge, extracts content, and interacts with pages.
- **Deep Document & PDF Intelligence:** Reads, indexes, and extracts tables and sections with built-in chunking and token budgeting.
- **Scheduled Routines & Background Workflows:** Wakes up on cron schedules to run digests, monitor sites, or review code.
- **Deterministic Guardrails:** Every external action (writing files, making HTTP calls, running commands) is governed by transparent rules where you decide whether the agent must ask for approval or can proceed automatically.

Everything runs on `localhost`. **Nothing leaves your laptop.**

---

## What’s New in v0.2.0

With the release of v0.2.0, OpenDot-Local moves from an experimental developer tool to a native desktop experience packed with power:

### 1. One-Click Native Windows & macOS Installers (`.exe` & `.dmg`)
No need to install Node.js, configure pnpm, or build source code manually. Download the installer, run the setup wizard, and you are ready.

### 2. Seamless First-Run Onboarding Wizard
The moment you launch OpenDot-Local:
- Automatically detects and connects to your local **Ollama** installation.
- Scans and validates available local models (like `qwen3:4b`, `llama3.2`, `mistral`, `deepseek-r1`).
- Auto-detects installed browsers (`Edge` / `Chrome`) with zero manual driver setup.

### 3. Hardware Auto-Tuning Engine
Running local LLMs requires balancing VRAM and context windows. OpenDot-Local v0.2 inspects your hardware (NVIDIA GPU, Apple Silicon, or CPU) and automatically assigns optimal context presets:
- **4 GB GPUs:** *Balanced* mode (8k context window, partial GPU offload).
- **8 GB+ GPUs & Apple Silicon:** *Quality* mode (16k context window, full GPU acceleration).
- **CPU-only laptops:** *Fast* mode (4k context window with low-latency streaming).
- *Full manual override available in Settings.*

### 4. "Ask My Folder" Knowledge Engine (SQLite FTS5 + BM25)
Point a Dot to any folder on your machine (code repos, PDF collections, research notes):
- Indexed locally using SQLite full-text search (FTS5) and BM25 relevance scoring.
- Automatic secret exclusion: `.env`, `.git`, SSH keys, and passwords are strictly excluded from indexing.
- **Verifiable Citation Badges:** Every answer includes exact file references and confidence indicators so you can verify where the answer came from.

### 5. Model Context Protocol (MCP) Connectors
Connect your local Dots to the broader ecosystem via Anthropic's **Model Context Protocol (MCP)**:
- Plug in local or remote MCP servers (filesystem, Git, databases, custom APIs).
- Sealed credential storage protects your environment variables and sensitive tokens in an encrypted local vault.

### 6. Dot Packs (`.opendot.json`)
Share, export, and import complete agent personas with a single click:
- Export your custom agents (prompts, skills, routines, and rules) to an `.opendot.json` pack.
- Import bundled packs out of the box:
  - 🔍 **Research Assistant:** Deep web search, multi-source synthesis, and citation generation.
  - 🛒 **Shopping Helper:** Price tracking, comparison, and product feature analysis.
  - 💻 **Code Reviewer:** Local git repository diff inspection, security checks, and refactoring tips.

### 7. Privacy Ledger & Strict Offline Mode
Want to guarantee that no network requests leave your computer?
- Toggle **Offline Mode** in Settings with a single click.
- The built-in **Privacy Ledger** inspects and logs every network request, blocking unauthorized outbound internet access instantly.

---

## Under The Hood: The Architecture

OpenDot-Local is built for performance and durability:
- **Frontend:** Next.js App Router, Tailwind CSS, Lucide icons, Three.js 3D avatars.
- **Desktop Shell:** Electron with hardened context isolation and secure IPC bridges.
- **Local Database:** Embedded `node:sqlite` database requiring zero external database drivers.
- **LLM Engine:** Native Ollama REST bridge with queue management, anti-stall timeouts, and `<think>` reasoning tag streaming filters.
- **Browser Automation:** Headless Playwright engine running local Chromium / Edge instances.

---

## Getting Started in 2 Minutes

### Option 1: Download the Desktop App
1. Head over to our official site: [https://opendot-local.vercel.app/](https://opendot-local.vercel.app/)
2. Download the latest installer for Windows or macOS.
3. Make sure [Ollama](https://ollama.ai) is running locally with your favorite model (e.g. `ollama run qwen3:4b`).
4. Launch OpenDot-Local and follow the on-screen wizard!

### Option 2: Run From Source
```bash
# Clone the repository
git clone https://github.com/VedantJadhav701/opendot-local.git
cd opendot-local

# Install dependencies
pnpm install

# Run the development environment
pnpm dev
```
Open [http://localhost:3100](http://localhost:3100) in your browser.

---

## Join the Journey

OpenDot-Local is 100% free, MIT licensed, and community-driven. If you believe the future of AI belongs on personal computers under user control, give us a star on GitHub!

- 🌐 **Official Website:** [https://opendot-local.vercel.app/](https://opendot-local.vercel.app/)
- ⭐ **GitHub Repository:** [https://github.com/VedantJadhav701/opendot-local](https://github.com/VedantJadhav701/opendot-local)
- 💬 **Feedback & Contributions:** PRs, bug reports, and Dot Packs are welcome!

---

*Built with ❤️ by [Vedant Jadhav](https://github.com/VedantJadhav701).*

**Tags:** #AI #OpenSource #Ollama #LocalLLM #AIAgents #AutonomousAgents #Privacy #DesktopApps #SoftwareEngineering
