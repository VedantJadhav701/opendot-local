import path from "node:path";
import fs from "node:fs";

import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";

async function runVerification() {
  console.log("=== Testing Fixes Live on qwen3:4b (think: false) ===");

  let dot = repo.findDotByName("OpenDot");
  if (!dot) {
    dot = repo.createDot({
      name: "OpenDot",
      purpose: "General assistant",
      instructions: "Be direct and helpful",
      look: { color: "blue", avatar: "robot" },
    });
  }
  repo.updateDot(dot.id, { status: "idle", model: "qwen3:4b" });

  console.log(`Using dot: ${dot.name} (${dot.id})`);

  console.log("\n--- Test Case A: URL Pre-routing & Download ---");
  const convA = repo.createConversation(dot.id, "chat", "Failure A Test");
  console.log("Sending URL download request...");
  sendMessage(dot.id, "go to this url: https://zenodo.org/records/23047307 and download the paper", [], convA.id);

  // Wait for turn completion
  await new Promise((resolve) => setTimeout(resolve, 15000));

  const messagesA = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convA.id);
  console.log("\nMessages for Test Case A:");
  for (const m of messagesA) {
    console.log(`[${m.role.toUpperCase()}]: ${m.text}`);
  }

  console.log("\n--- Test Case B: Web Search & Duplicate Guard ---");
  const convB = repo.createConversation(dot.id, "chat", "Failure B Test");
  console.log("Sending search request...");
  sendMessage(dot.id, "find a best headphone under 2000 rs", [], convB.id);

  // Wait for turn completion
  await new Promise((resolve) => setTimeout(resolve, 25000));

  const messagesB = repo.dotMessages(dot.id, 50).filter((m) => m.conversationId === convB.id);
  console.log("\nMessages for Test Case B:");
  for (const m of messagesB) {
    console.log(`[${m.role.toUpperCase()}]: ${m.text}`);
  }
}

runVerification().catch(console.error);
