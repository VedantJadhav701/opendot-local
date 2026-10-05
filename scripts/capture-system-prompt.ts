import fs from "node:fs";
import path from "node:path";
import * as repo from "../src/server/repo";
import { systemPrompt } from "../src/server/agent/prompt";

async function capturePrompt() {
  const dot = repo.listDots()[0] || repo.createDot({
    name: "OpenDot",
    purpose: "General assistant",
    instructions: "Be concise and direct",
    look: { color: "blue", avatar: "robot" },
  });

  const promptText = systemPrompt(dot, { kind: "chat" });

  console.log("--- LIVE SYSTEM PROMPT GENERATED ---");
  console.log(promptText);
  console.log("-------------------------------------");

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "system-prompt-live.txt"), promptText);
  console.log("Saved live system prompt to docs/raw/system-prompt-live.txt");
}

capturePrompt().catch(console.error);
