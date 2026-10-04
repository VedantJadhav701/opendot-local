import fs from "node:fs";
import path from "node:path";
import * as repo from "../src/server/repo";
import { setProvider } from "../src/server/llm/registry";
import type { ChatChunk, ChatMessage, ChatRequest, LLMProvider } from "../src/server/llm/types";
import { sendMessage } from "../src/server/agent/runtime";

class MockLoopProvider implements LLMProvider {
  public name = "mock";
  public callsReceived: { step: number; toolCalls?: any[]; messages: ChatMessage[]; toolsCount: number }[] = [];

  public async health() {
    return true;
  }

  public async listModels() {
    return [{ id: "mock-model", name: "Mock Model" }];
  }

  public async chat(req: ChatRequest, signal?: AbortSignal) {
    const msg = await this.chatStream(req, () => {}, signal);
    return { message: msg, finishReason: "stop" };
  }

  public async chatStream(req: ChatRequest, onChunk: (chunk: ChatChunk) => void, signal?: AbortSignal): Promise<ChatMessage> {
    const step = req.messages.filter((m) => m.role === "assistant").length;

    this.callsReceived.push({
      step,
      messages: JSON.parse(JSON.stringify(req.messages)),
      toolsCount: req.tools?.length ?? 0,
    });

    // Check if tools are omitted (Step 6 / MAX_STEPS hard cap)
    if (!req.tools || req.tools.length === 0) {
      const text = "Final text answer after tool cap reached.";
      onChunk({ delta: { content: text } });
      return { role: "assistant", content: text };
    }

    // Attempt duplicate tool call repeatedly
    const toolCall = {
      id: `call_${step}`,
      type: "function" as const,
      function: {
        name: "list_files",
        arguments: JSON.stringify({}),
      },
    };

    onChunk({ delta: { tool_calls: [toolCall] } });
    return {
      role: "assistant",
      content: "",
      tool_calls: [toolCall],
    };
  }
}

async function runMockLoopTest() {
  console.log("=== Testing Item 7: Loop Guard & Pre-routing with Mock Provider ===");

  let report = "=== MOCK PROVIDER LOOP GUARD AND PRE-ROUTING TEST REPORT ===\n\n";

  const mockProvider = new MockLoopProvider();
  setProvider(mockProvider);

  const dot = repo.findDotByName("OpenDot") || repo.createDot({
    name: "OpenDot",
    purpose: "Test dot",
    look: { color: "blue", avatar: "robot" },
  });
  repo.updateDot(dot.id, { model: "mock-model", status: "idle" });

  const waitForIdle = async () => {
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 50; i++) {
      const currentDot = repo.getDot(dot.id);
      if (currentDot && (currentDot.status === "idle" || currentDot.status === "waiting")) {
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  // Test 1: Duplicate tool call loop guard
  console.log("\n1. Running Duplicate Call Loop Guard Test...");
  mockProvider.callsReceived = [];
  const conv1 = repo.createConversation(dot.id, "chat", "Mock Loop Test 1");
  sendMessage(dot.id, "find a best headphone under 2000 rs", [], conv1.id);

  await waitForIdle();

  report += "--- TEST 1: DUPLICATE TOOL CALL LOOP GUARD ---\n";
  report += `Total LLM Call Steps Executed: ${mockProvider.callsReceived.length}\n`;
  for (const call of mockProvider.callsReceived) {
    report += `\n[LLM Step ${call.step}] (Tools available: ${call.toolsCount})\n`;
    const lastMsg = call.messages[call.messages.length - 1];
    report += `  Last Input Role: ${lastMsg.role}\n`;
    if (lastMsg.role === "tool") {
      report += `  Tool Output Content: ${lastMsg.content}\n`;
    } else {
      report += `  Content: ${lastMsg.content.slice(0, 100)}\n`;
    }
  }
  report += "\n";

  // Test 2: URL Pre-routing before first LLM call
  console.log("\n2. Running URL Pre-routing Before First Model Call Test...");
  mockProvider.callsReceived = [];
  const conv2 = repo.createConversation(dot.id, "chat", "Mock Loop Test 2");
  sendMessage(dot.id, "go to this url: https://zenodo.org/records/23047307 and download the paper", [], conv2.id);

  await waitForIdle();

  report += "--- TEST 2: URL PRE-ROUTING BEFORE FIRST MODEL CALL ---\n";
  if (mockProvider.callsReceived.length > 0) {
    const firstCall = mockProvider.callsReceived[0];
    const userMsg = firstCall.messages.find((m) => m.role === "user");
    report += `First Model Call User Message Present: ${Boolean(userMsg)}\n`;
    report += `User Message Content Sample:\n${userMsg?.content.slice(0, 400)}\n`;
  }

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "mock-loop-item7.txt"), report);
  console.log("\nSaved report to docs/raw/mock-loop-item7.txt");
}

runMockLoopTest().catch(console.error);
