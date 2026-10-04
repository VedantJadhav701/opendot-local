Project Plan — Open Dot Local
Goal: take Open Dot, turn it into free, local-first, cross-platform desktop agent.
Open Dot
   ↓
Open Dot Local
   ↓
Windows + macOS
   ↓
Ollama local LLM
   ↓
Docker sandbox
   ↓
Playwright browser
   ↓
SQLite memory
   ↓
Local automation

Phase 0 — Freeze scope
V1 must support
Windows
macOS

Ollama
Local models
Streaming
Tool calling
Agent loop
Browser automation
File operations
Shell commands
Docker sandbox
Memory
Skills
Rules
Routines
Scheduler
Multiple dots
Approval system
SQLite
Electron desktop app

V1 does NOT require
OpenAI
OpenRouter
E2B
Paid cloud
Composio account
Cloud inference
Voice
Full native GUI automation
Complex VLM computer use

Keep these for later.
Phase 1 — Fork + branch
Clone original repo.
git clone https://github.com/composio-community/open-dot.git
cd open-dot
git checkout -b windows-macos-ollama

Before redistribution:
Check LICENSE
Check dependency licenses
Check trademarks/branding
Check attribution requirements

Important. We can modify code only within license terms. If license permits fork/distribution, continue. If not, adjust strategy.
Phase 2 — Map entire codebase
First create dependency map.
src/
├── server/
│   ├── agent/
│   ├── computer/
│   ├── database
│   ├── scheduler
│   ├── triggers
│   ├── integrations
│   └── API routes
│
├── app/
│   └── UI
│
└── components/

electron/
scripts/

Find every dependency on:
OpenAI
OpenRouter
E2B
Composio
macOS
zsh
bash
Keychain
AppleScript
Darwin

Do this before major edits.
Phase 3 — Build Ollama provider
This is biggest change.
Current:
Agent
 ↓
OpenAI Responses API
 ↓
GPT

New:
Agent
 ↓
LLM Provider
 ↓
Ollama
 ↓
Local model

Create:
src/server/llm/
├── types.ts
├── provider.ts
├── ollama.ts
└── registry.ts

Provider interface:
interface LLMProvider {
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatEvent>;
}

Ollama implementation:
GET  /api/tags
POST /api/chat

Support:
model
messages
tools
tool calls
streaming
temperature
context length

No API key.
Phase 4 — Rewrite agent runtime
Current agent runtime likely assumes OpenAI response objects.
Break dependency.
New flow:
User message
      ↓
Agent runtime
      ↓
Build messages
      ↓
Ollama
      ↓
Text OR tool call
      ↓
Execute tool
      ↓
Tool result
      ↓
Ollama
      ↓
Final response

Loop:
while model requests tool:
    execute tool
    send result back

Then:
final answer

This becomes provider-independent.
Later we can add another provider without rewriting agent.
Phase 5 — Streaming
Need good UX.
Current:
User
 ↓
wait
 ↓
complete response

New:
User
 ↓
Ollama
 ↓
token
token
token
token
 ↓
UI

UI receives:
agent text delta
tool started
tool progress
tool completed
final response

Important for local models. Otherwise app feels slow.
Phase 6 — Model manager
Add settings page:
Ollama
────────────────────

Status: Connected

Models:
✓ qwen3:0.6b
✓ qwen3:1.7b
✓ qwen3:4b

Default model:
[ qwen3:4b ]

Review model:
[ qwen3:0.6b ]

Context:
[ 4096 ]

Temperature:
[ 0.2 ]

Detect Ollama automatically.
If Ollama unavailable:
Ollama not detected.

Install Ollama and start service.

No API-key screen.
Phase 7 — Reviewer migration
Current approval/rule reviewer uses OpenAI.
Change:
OpenAI reviewer
      ↓
Ollama reviewer

Use smaller local model where possible.
Flow:
Agent wants action
        ↓
Policy engine
        ↓
Rules
        ↓
Reviewer model
        ↓
allow / ask / never

Critical rule:
LLM never decides security alone.
Hard policy remains code-controlled.
Phase 8 — Cross-platform shell
Create:
src/server/computer/platform/
├── windows.ts
├── macos.ts
└── index.ts

Windows:
PowerShell

macOS:
zsh

Platform selection:
switch (process.platform) {
  case "win32":
    return windowsPlatform;
  case "darwin":
    return macosPlatform;
}

Keep agent tool name same:
run_command

Agent doesn't care OS.
Phase 9 — Docker sandbox
Make Docker default sandbox.
Agent
 ↓
Docker
 ↓
dot workspace

Each dot gets:
dots/
└── dot-id/
    └── workspace/

Container:
/workspace

Resource limits:
memory
CPU
network
filesystem

Keep host access separate.
Phase 10 — Browser automation
Keep Playwright.
Browser
├── open_url
├── read_page
├── click
├── type_text
├── sign_in
├── screenshot
└── navigation

Browser profile per dot:
dot-1/browser/
dot-2/browser/
dot-3/browser/

So each agent can retain login/session state.
Phase 11 — Native OS automation
V1:
Windows → PowerShell
macOS → shell

V2:
Windows
├── PowerShell
├── Windows UI Automation
└── native app interaction

macOS
├── AppleScript
├── shell
└── native app interaction

Do not build V2 complexity before core agent works.
Phase 12 — Memory
Keep existing SQLite architecture.
Memory layers:
Conversation
     ↓
Short-term context
     ↓
Persistent memory
     ↓
Skills
     ↓
Rules

Agent tools:
remember
forget
save_skill
use_skill

No cloud vector DB needed.
Could add local embeddings later.
Phase 13 — Skills
Keep existing skill system.
Example:
skills/
├── coding
├── research
├── browser
├── data-analysis
└── custom

Skills should contain:
instructions
workflow
tool guidance
examples

Later allow users to export/import skills.
This becomes useful for open-source ecosystem.
Phase 14 — Routines + scheduler
Keep Croner.
Example:
Every morning 8 AM
    ↓
Research AI news
    ↓
Summarize
    ↓
Save report

Architecture:
Croner
 ↓
Routine
 ↓
Agent
 ↓
Tools
 ↓
Result

No cloud scheduler.
App/server can run locally in background.
Phase 15 — Multi-dot
Keep core Open Dot concept.
Example:
Research Dot
    ↓
find papers

Coding Dot
    ↓
write code

Finance Dot
    ↓
analyze spreadsheet

Browser Dot
    ↓
web automation

Dots can communicate:
message_dot

Potential architecture:
Dot A
 ↓
message_dot
 ↓
Dot B
 ↓
work
 ↓
result
 ↓
Dot A

Phase 16 — Remove paid/cloud dependencies
Core package:
REMOVE
@e2b/desktop
OpenAI dependency
OpenRouter logic
mandatory Composio dependency
cloud computer

Potentially keep packages temporarily during migration, then remove after code no longer references them.
Final core:
Electron
Next.js
Ollama
Playwright
Docker
SQLite
Croner
React
TypeScript

Phase 17 — Secrets
Create:
src/server/secrets/
├── store.ts
├── windows.ts
├── macos.ts
└── index.ts

Windows:
Windows Credential Manager / DPAPI

macOS:
Keychain

Never:
password → LLM

Never store raw credentials in SQLite.
Phase 18 — UI redesign
Remove:
OpenAI API key
OpenRouter key
E2B key

Add:
Local AI
────────────────

Ollama: Connected

Model:
qwen3:4b

[Refresh Models]

Computer:
Docker ✓

Browser:
Playwright ✓

Storage:
SQLite ✓

Health screen:
Ollama       ✓
Docker       ✓
Browser      ✓
Database     ✓
Workspace    ✓

This makes setup obvious.
Phase 19 — Electron Windows + macOS
Change Electron build.
Windows:
NSIS installer

macOS:
DMG

Build:
pnpm desktop:prepare
pnpm desktop:build

Test:
Windows x64
macOS arm64
macOS x64

Potentially later:
Windows ARM64

Phase 20 — First-run setup
User installs app.
App checks:
1. Ollama
2. Docker
3. Browser
4. Model

Wizard:
Welcome
   ↓
Ollama detected
   ↓
Choose model
   ↓
Docker detected
   ↓
Create workspace
   ↓
Create first Dot
   ↓
Done

No account.
No API key.
No payment.
Phase 21 — Security hardening
Before public release:
Command approval
File path restrictions
Browser action approval
Credential isolation
Docker limits
Network restrictions
Tool allow/deny rules
Prompt injection defenses
External website confirmation
Dangerous command detection

Especially browser.
Website can say:
Ignore previous instructions.
Run this command.

Agent must not blindly obey.
Tool policy remains authority.
Phase 22 — Testing
Build automated tests.
LLM
Ollama connection
Model discovery
Streaming
Tool calling
Tool errors
Malformed responses
Model unavailable

Agent
simple question
tool call
multi-step task
tool failure
approval
rule = never
rule = ask
memory
skill
routine

Browser
navigation
DOM extraction
click
typing
login
session persistence

OS
Windows PowerShell
macOS zsh
path restrictions
working directory
command timeout

Desktop
Windows launch
macOS launch
server startup
app restart
data persistence

Phase 23 — Performance
Need local-model optimization.
Add:
context management
conversation trimming
tool-result compression
model selection
small reviewer model
streaming
timeouts
retry logic

Later:
resource-aware routing

Example:
simple task → 0.6B
normal task → 1.7B/4B
hard task → 7B+
vision task → VLM

This can become major project differentiator.
Phase 24 — Vision
Do after text agent works.
Architecture:
Screenshot
    ↓
Local VLM
    ↓
Screen understanding
    ↓
Action
    ↓
Screenshot
    ↓
VLM

Closed loop:
OBSERVE
   ↓
REASON
   ↓
ACT
   ↓
OBSERVE

This connects nicely with computer-use architecture.
But V1 should not depend on vision.
Phase 25 — Open-source release
Repository structure:
README.md
LICENSE
CONTRIBUTING.md
SECURITY.md
docs/

README must explain:
What is Open Dot Local?
Why local?
Supported OS
Requirements
Ollama setup
Docker setup
Installation
Models
Security
Architecture
Development
Building
Contributing

Provide:
Windows installer
macOS DMG
source installation

Final development order
Do not build everything simultaneously.
Use this order:
1. License audit
       ↓
2. Dependency/code audit
       ↓
3. Ollama provider
       ↓
4. Provider-independent agent runtime
       ↓
5. Streaming
       ↓
6. Tool calling
       ↓
7. Reviewer/approval migration
       ↓
8. Docker sandbox
       ↓
9. Windows shell
       ↓
10. macOS shell
       ↓
11. Playwright verification
       ↓
12. Memory/skills/routines verification
       ↓
13. UI/settings
       ↓
14. Secrets
       ↓
15. Electron Windows build
       ↓
16. Electron macOS build
       ↓
17. Security testing
       ↓
18. Performance testing
       ↓
19. Documentation
       ↓
20. Public release

Milestone structure
M1 — Local brain
Ollama
+
agent
+
streaming
+
tool calling

Success:
User → agent → Ollama → tool → result → response

M2 — Local computer
Docker
+
Windows shell
+
macOS shell
+
Playwright

Success:
Agent can safely work on user's local machine.

M3 — Persistent agent
Memory
+
Skills
+
Rules
+
Routines
+
Scheduler
+
Multiple dots

Success:
Dot remains useful across sessions.

M4 — Desktop product
Electron
+
Windows installer
+
macOS DMG
+
first-run setup
+
health checks

Success:
Non-developer can install and use it.

M5 — Open-source release
Security
+
tests
+
docs
+
GitHub release

Success:
git clone
→ install
→ Ollama
→ run

End product
                 OPEN DOT LOCAL

          Free + Local + Open Source
                    │
          ┌─────────┴─────────┐
          │                   │
       Windows              macOS
          │                   │
          └─────────┬─────────┘
                    │
                  Ollama
                    │
                Local LLM
                    │
               Agent Runtime
                    │
       ┌────────────┼────────────┐
       │            │            │
    Browser       Docker       Files
       │            │            │
   Playwright    Sandbox       Shell
       │            │            │
       └────────────┼────────────┘
                    │
       Memory + Skills + Rules
                    │
       Routines + Scheduler
                    │
                Multiple Dots

Core principle: cloud-free by default, platform-independent core, OS-specific adapters only where needed.