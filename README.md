# Open Dot Local

**Open Dot Local** is a free, local-first, cross-platform (Windows & macOS) personal AI desktop agent powered by local Ollama models.

---

## 🌟 Key Features

- **Local LLM Engine**: Powered by [Ollama](https://ollama.com). Runs 100% locally on your machine with zero cloud API key requirements (Qwen, Llama, Mistral, etc.).
- **Cross-Platform Shell**: Runs scripts and terminal tasks safely on **Windows (PowerShell)** and **macOS/Linux (POSIX shell)**.
- **Docker Sandbox Support**: Optionally isolates dot execution inside Docker containers, with graceful fallback to workspace directories.
- **Browser Automation**: Playwright-powered local browser with persistent login states per dot.
- **Local SQLite Storage**: Saves conversation history, skills, rules, and routines locally in SQLite (`node:sqlite`).
- **Encrypted Password Storage**: Protects sensitive logins using native OS encryption (DPAPI on Windows, Keychain on macOS).
- **Multi-Dot Collaboration**: Create specialized dots that delegate work to each other.
- **Rules & Approvals**: Hardened policy checks for risky actions with interactive user approval cards.

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js**: v22.0.0 or higher
2. **pnpm**: `npm install -g pnpm` or `npx pnpm`
3. **Ollama**: Installed and running locally (`ollama serve` / `http://127.0.0.1:11434`)
   - Pull a model: `ollama pull qwen3:4b`

### Run from Source

```bash
# Clone the repository
git clone https://github.com/VedantJadhav701/opendot-local.git
cd opendot-local

# Install dependencies
pnpm install

# Run web dev server
pnpm dev

# (Optional) Run Electron desktop wrapper
pnpm desktop:dev
```

### Desktop Packaging

Build standalone installers for your OS:

```bash
# Prepare the desktop server bundle
pnpm desktop:prepare

# Build Windows NSIS installer (.exe)
pnpm desktop:build:win

# Build macOS DMG installer (.dmg)
pnpm desktop:build:mac
```

---

## 🛠 Architecture Overview

```
electron/main.mjs         Cross-platform desktop application host (Windows & macOS)
scripts/desktop-*.mjs     Packages standalone Next.js server into Electron app
src/server/
  llm/                    Local LLM Provider (Ollama API stream & tool calling)
  agent/runtime.ts        Provider-independent streaming agent loop & approvals
  agent/tools.ts          Agent tools and safety rule checks
  agent/review.ts         Local rule evaluation model
  computer/platform/      Cross-platform shell execution (Windows PowerShell / macOS POSIX)
  computer/shell.ts       Workspace file operations & Docker sandbox manager
  computer/browser.ts     Playwright browser automation per dot
  secrets/                Native OS secret store (Windows DPAPI / macOS Keychain)
  repo.ts, db.ts          Local SQLite database
```

---

## 📜 License & Open Source Attribution

Open Dot Local is released under open-source software license terms.
