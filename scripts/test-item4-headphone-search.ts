import fs from "node:fs";
import path from "node:path";
import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";
import { db } from "../src/server/db";

async function runTurnSync(dotId: string, text: string, conversationId: string, maxMs = 300000) {
  sendMessage(dotId, text, [], conversationId);
  const start = Date.now();
  let startedWorking = false;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 500));
    const d = repo.getDot(dotId);
    if (!d) continue;
    if (d.status === "working") {
      startedWorking = true;
    }
    if (startedWorking && d.status === "idle") {
      return Date.now() - start;
    }
  }
  return Date.now() - start;
}

async function runShoppingTest() {
  console.log("=== Running Item 4 Shopping Search Test ===");

  const dot = repo.findDotByName("OpenDot") || repo.createDot({
    name: "OpenDot",
    purpose: "Live Proof Agent",
    look: { color: "blue", avatar: "robot" },
  });
  repo.updateDot(dot.id, { model: "qwen3:4b-instruct-2507", status: "idle" });
  db().prepare("UPDATE dots SET status = 'idle' WHERE id = ?").run(dot.id);

  const conv = repo.createConversation(dot.id, "chat", "Item 4 Shopping Search Test");
  const prompt = "find a best headphone under 2000 rs";

  console.log(`Sending prompt: "${prompt}"...`);
  const duration = await runTurnSync(dot.id, prompt, conv.id, 300000);

  const msgs = repo.dotMessages(dot.id, 100).filter((m) => m.conversationId === conv.id);

  let report = "=== ITEM 4 RAW SHOPPING PAGE EXTRACT AND RESPONSE ===\n";
  report += `Timestamp: ${new Date().toISOString()}\n`;
  report += `Prompt: ${prompt}\n`;
  report += `Duration: ${duration} ms\n\n`;

  report += "--- MESSAGES AND TOOL EXTRACTS ---\n";
  for (const m of msgs) {
    report += `[${m.role.toUpperCase()}]: ${m.text}\n`;
  }

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "shopping-headphone-extract.txt");
  fs.writeFileSync(outPath, report);
  console.log(`Saved report to ${outPath}`);
}

runShoppingTest().catch(console.error);
