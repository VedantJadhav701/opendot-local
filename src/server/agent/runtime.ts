import "server-only";
import { activeModel, getProvider } from "../llm";
import type { ChatMessage, FunctionToolCall, ToolDefinition } from "../llm";
import { systemPrompt, type Trigger } from "./prompt";
import { findTool, setConsult, toolsForDot, type ToolCtx } from "./tools";
import { review } from "./review";
import * as repo from "../repo";
import * as computer from "../computer";
import type { ComputerAction } from "../computer/browser";
import { emit } from "../bus";
import * as composio from "../composio";
import type { AppTrigger, Attachment, CardData, Dot, Routine } from "@/lib/types";
import * as files from "../files";
import { getTaskChunks } from "../context/db";

type Pending = {
  responseId: string;
  calls: FunctionToolCall[];
  outputs: ChatMessage[];
  index: number;
  cardId: string | null;
  trigger: Trigger;
};

type InboxItem = { text: string; trigger: Trigger; conversationId: string; attachments?: Attachment[] };
type RunState = { running: boolean; abort: AbortController | null; inbox: InboxItem[]; after: (() => void)[] };

const MAX_STEPS = 6;
const g = globalThis as unknown as { __dotsRuns?: Map<string, RunState> };
const runs = (g.__dotsRuns ??= new Map());
const state = (dotId: string): RunState => {
  let s = runs.get(dotId);
  if (!s) runs.set(dotId, (s = { running: false, abort: null, inbox: [], after: [] }));
  s.after ??= [];
  return s;
};

// ---------------------------------------------------------------- public API

export function sendMessage(dotId: string, text: string, attachments: Attachment[] = [], conversationId?: string) {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("No such dot");
  const conv = conversationId ?? repo.latestConversationId(dotId);
  repo.addMessage({ dotId, role: "user", text, attachments, conversationId: conv });
  if (dot.status === "paused") {
    repo.addMessage({ dotId, role: "system", text: `${dot.name} is paused. Resume it to pick this up.`, conversationId: conv });
  }
  state(dotId).inbox.push({ text, trigger: { kind: "chat" }, attachments, conversationId: conv });
  void pump(dotId);
}

export function queueTask(dotId: string, text: string, conversationId: string) {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("No such dot");
  repo.addMessage({ dotId, role: "activity", text: `Voice task · ${text}`, conversationId, channelId: null });
  if (dot.status === "paused") repo.addMessage({ dotId, role: "system", text: `${dot.name} is paused. Resume it to pick this up.`, conversationId });
  state(dotId).inbox.push({ text: `${text}\n\n(Asked on a voice call.)`, trigger: { kind: "chat" }, conversationId });
  void pump(dotId);
}

export function sendToChannel(channelId: string, text: string) {
  const ch = repo.getChannel(channelId);
  if (!ch) throw new Error("No such channel");
  repo.addMessage({ dotId: ch.leadId, role: "user", text, channelId });
  const members = ch.memberIds.map((id) => repo.getDot(id)).filter((d): d is Dot => Boolean(d));
  const mentioned = members.filter((d) => new RegExp(`@${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  const responders = mentioned.length ? mentioned : members.filter((d) => d.id === ch.leadId);
  for (const d of responders) {
    if (d.status === "paused") {
      repo.addMessage({ dotId: d.id, role: "system", text: `${d.name} is paused.`, channelId });
      continue;
    }
    state(d.id).inbox.push({
      text: `[#${ch.name}] ${text}`,
      trigger: { kind: "channel", channelId, name: ch.name },
      conversationId: repo.workConversation(d.id, "channel", channelId, `#${ch.name}`),
    });
    void pump(d.id);
  }
}

export function runRoutine(routine: Routine) {
  const dot = repo.getDot(routine.dotId);
  if (!dot || dot.status === "paused" || !routine.enabled) return;
  repo.updateRoutine(routine.id, { lastRunAt: Date.now() });
  const conv = repo.workConversation(dot.id, "chat", `routine:${routine.id}`, `Routine · ${routine.name}`);
  repo.addMessage({ dotId: dot.id, role: "system", text: `Routine “${routine.name}” started`, from: `routine:${routine.name}`, conversationId: conv });
  state(dot.id).inbox.push({ text: `[Routine: ${routine.name}] ${routine.instruction}`, trigger: { kind: "routine", name: routine.name }, conversationId: conv });
  void pump(dot.id);
}

export function runTrigger(t: AppTrigger, event: Record<string, unknown>) {
  const dot = repo.getDot(t.dotId);
  if (!dot || dot.status === "paused" || !t.enabled) return;
  const conv = repo.workConversation(dot.id, "chat", `trigger:${t.id}`, `Trigger · ${t.name}`);
  repo.addMessage({ dotId: dot.id, role: "system", text: `Trigger “${t.name}” fired`, from: `trigger:${t.name}`, conversationId: conv });
  const data = JSON.stringify(event, null, 1).slice(0, 6000);
  state(dot.id).inbox.push({ text: `[Trigger: ${t.name}] ${t.instruction}\n\nWhat happened (${t.toolkit} event data):\n${data}`, trigger: { kind: "trigger", name: t.name }, conversationId: conv });
  void pump(dot.id);
}

export function stop(dotId: string) {
  const s = state(dotId);
  s.inbox = [];
  s.abort?.abort();
}

export function pause(dotId: string) {
  const dot = repo.getDot(dotId);
  if (!dot || dot.status === "paused") return;
  repo.updateDot(dotId, { status: "paused" });
  state(dotId).abort?.abort();
  repo.addMessage({ dotId, role: "system", text: `Paused. Any ongoing work was stopped, and ${dot.name} won't message you until you resume it.` });
  void computer.sleep(dotId).catch(() => {});
}

export function resume(dotId: string) {
  const dot = repo.getDot(dotId);
  if (!dot || dot.status !== "paused") return;
  const waiting = repo.pendingCards(dotId).length > 0;
  repo.updateDot(dotId, { status: waiting ? "waiting" : "idle" });
  repo.addMessage({ dotId, role: "system", text: `${dot.name} resumed.` });
  void pump(dotId);
}

export async function resolveCard(messageId: string, choice: "approve" | "deny" | "always" | "answer", answer?: string) {
  const msg = repo.getMessage(messageId);
  const card = msg?.card;
  if (!msg || !card || card.status !== "pending") return;
  const dot = repo.getDot(msg.dotId);
  if (!dot || dot.status === "paused") return;

  const approved = choice === "approve" || choice === "always";
  const status: CardData["status"] = choice === "answer" ? "answered" : approved ? "approved" : "denied";
  repo.updateMessage(messageId, { card: { ...card, status, answer } });
  if (choice === "always" && card.ruleAction) repo.addRule({ dotId: dot.id, action: card.ruleAction, decision: "allow" });

  const convId = msg.conversationId ?? repo.latestConversationId(dot.id);
  const pending = parsePending(repo.threadOf(convId).pending);
  if (!pending || pending.cardId !== messageId) return;

  await withRun(dot.id, async (signal) => {
    repo.routeToConversation(dot.id, convId);
    repo.routeToChannel(dot.id, pending.trigger.kind === "channel" ? pending.trigger.channelId : null);
    const call = pending.calls[pending.index];
    pending.cardId = null;

    const def = findTool(call.function.name);
    let outputText: string;
    if (def?.pause === "question") outputText = `The user answered: ${answer ?? ""}`;
    else if (def?.pause === "approval") outputText = approved ? "The user approved. Go ahead." : "The user denied this. Do not do it; tell them briefly what you'll do instead, if anything.";
    else if (def?.pause === "connect") outputText = approved ? "Connected. Continue with the task." : "The user chose not to connect this app right now. Continue without it or tell them what you need.";
    else if (approved && def?.execute) outputText = await execTool(dot, call, signal);
    else outputText = "The user denied this action. Don't retry it; continue without it or ask what they'd prefer.";

    pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: outputText });

    pending.index++;
    if (await processCalls(dot, pending, signal)) return;
    await drive(dot, pending.outputs, pending.trigger, signal);
  });
}

// ---------------------------------------------------------------- run loop

async function pump(dotId: string) {
  const s = state(dotId);
  if (s.running) return;
  const dot = repo.getDot(dotId);
  if (!dot || dot.status === "paused" || !s.inbox.length) return;

  const where = (i: InboxItem) => (i.trigger.kind === "channel" ? `channel:${i.trigger.channelId}` : `conv:${i.conversationId}`);
  const head = where(s.inbox[0]);
  let n = 0;
  while (n < s.inbox.length && where(s.inbox[n]) === head) n++;
  const batch = s.inbox.splice(0, n);
  const trigger = batch.find((b) => b.trigger.kind === "chat")?.trigger ?? batch[batch.length - 1].trigger;
  const attachments = batch.flatMap((b) => b.attachments ?? []);
  const conversationId = batch[0].conversationId;
  let text = batch.map((b) => b.text).join("\n\n");

  const voice = conversationId ? repo.takeVoiceTranscript(conversationId, dot.name) : "";
  if (voice) text = `[Voice call in this chat since your last turn — you (on the call) and the user said:]\n${voice}\n\n[Now:]\n${text}`;
  await withRun(dotId, (signal) => turn(dotId, text, trigger, signal, attachments, conversationId));
}

async function withRun(dotId: string, fn: (signal: AbortSignal) => Promise<void>) {
  const s = state(dotId);
  if (s.running) {
    s.after.push(() => void withRun(dotId, fn));
    return;
  }
  s.running = true;
  s.abort = new AbortController();
  const startedAt = Date.now();
  repo.updateDot(dotId, { status: "working" });
  try {
    await fn(s.abort.signal);
  } catch (err) {
    if (!s.abort.signal.aborted) {
      console.error("[dots] run failed", err);
      repo.addMessage({ dotId, role: "system", text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` });
    }
  } finally {
    s.running = false;
    s.abort = null;
    repo.routeToChannel(dotId, null);
    repo.setActivity(dotId, null);
    const dot = repo.getDot(dotId);
    if (dot && dot.status !== "paused") {
      repo.updateDot(dotId, { status: repo.pendingCards(dotId).length ? "waiting" : "idle" });
      notifyFinished(dot, startedAt);
    }
    repo.routeToConversation(dotId, null);
    const next = dot?.status !== "paused" ? s.after.shift() : undefined;
    if (next) next();
    else if (dot?.status !== "paused" && s.inbox.length) void pump(dotId);
  }
}

function notifyFinished(dot: Dot, since: number) {
  const fresh = repo.dotMessages(dot.id, 20).filter((m) => m.createdAt >= since && (m.role === "dot" || m.role === "card"));
  const last = fresh[fresh.length - 1];
  if (!last || last.title) return;
  const body = last.role === "card" ? `Needs your approval: ${last.card?.title ?? ""}` : last.text;
  emit({ type: "notify", dotId: dot.id, title: last.role === "card" ? `${dot.name} needs you` : dot.name, body: body.slice(0, 160) });
}

async function preprocessUrls(text: string, dotId: string): Promise<string> {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch) return text;

  const url = urlMatch[0].replace(/[.,;)]+$/, "");
  const lowerText = text.toLowerCase();
  const isPdfUrl = url.toLowerCase().endsWith(".pdf") || lowerText.includes("download");

  try {
    if (isPdfUrl) {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const { extractPdf, isPdfBuffer } = await import("../context/pdf");
        if (isPdfBuffer(buf) || url.toLowerCase().endsWith(".pdf")) {
          const pdfRes = await extractPdf(buf);
          const { chunkText } = await import("../context/chunker");
          const { saveChunks } = await import("../context/db");

          const fileName = url.split("/").pop() || "downloaded.pdf";
          const taskId = `task_preroute_${Date.now()}`;
          const chunks = chunkText({
            text: pdfRes.fullText,
            source: fileName,
            taskId,
            dotId,
          });
          saveChunks(chunks);

          const sampleText = pdfRes.fullText.slice(0, 5000);
          return `${text}\n\n[Pre-fetched URL Content (${url}) - Extracted PDF ${pdfRes.pageCount} pages, ${chunks.length} chunks stored in chunk_store]:\n${sampleText}`;
        }
      }
    } else {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) {
        const html = await res.text();
        const cleanText = html.replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, "\n")
          .replace(/\n\s*\n/g, "\n")
          .trim();
        const sampleText = cleanText.slice(0, 5000);
        return `${text}\n\n[Pre-fetched URL Content (${url})]:\n${sampleText}`;
      }
    }
  } catch (err) {
    console.error("[dots] URL pre-routing failed:", err);
  }
  return text;
}

async function turn(dotId: string, text: string, trigger: Trigger, signal: AbortSignal, attachments: Attachment[], conversationId: string) {
  repo.routeToConversation(dotId, conversationId);
  repo.routeToChannel(dotId, trigger.kind === "channel" ? trigger.channelId : null);
  const dot = repo.getDot(dotId)!;

  const processedText = await preprocessUrls(text, dotId);
  const messages: ChatMessage[] = rebuildContextMessages(dotId, processedText);
  messages.push(userInput(dotId, processedText, attachments));

  await drive(dot, messages, trigger, signal);
}

async function drive(dot: Dot, messages: ChatMessage[], trigger: Trigger, signal: AbortSignal) {
  let turnTotalTimeMs = 0;
  let turnPromptTokens = 0;
  let turnCompletionTokens = 0;
  let totalSteps = 0;
  const seenCalls = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step++) {
    totalSteps = step + 1;
    signal.throwIfAborted();
    let assistantMessage: ChatMessage;
    try {
      const omitTools = step === MAX_STEPS - 1;
      assistantMessage = await respond(dot, messages, trigger, signal, omitTools);
    } catch (err) {
      if (signal.aborted) throw err;
      throw err;
    }

    if (assistantMessage.metrics) {
      const m = assistantMessage.metrics;
      turnTotalTimeMs += m.totalTimeMs;
      turnPromptTokens += m.promptTokens;
      turnCompletionTokens += m.completionTokens;
      console.log(
        `[dots] Turn Step ${totalSteps}/${MAX_STEPS} | Model: ${dot.model || "default"} | Queue Wait: ${m.queueWaitMs ?? 0}ms | TTFT: ${m.ttftMs}ms | Total: ${m.totalTimeMs}ms | Prompt Tokens: ${m.promptTokens} | Completion Tokens: ${m.completionTokens}`
      );
    }

    messages.push(assistantMessage);

    const calls = assistantMessage.tool_calls || [];
    if (!calls.length) {
      console.log(
        `[dots] Turn Summary | Total Time: ${turnTotalTimeMs}ms | Steps: ${totalSteps} | Total Prompt Tokens: ${turnPromptTokens}`
      );
      return;
    }

    const responseId = `resp_${Date.now()}`;
    const pending: Pending = { responseId, calls, outputs: [], index: 0, cardId: null, trigger };

    if (await processCalls(dot, pending, signal, seenCalls)) return; // Waiting for user input/card

    for (const toolOutputMsg of pending.outputs) {
      messages.push(toolOutputMsg);
    }
  }
  console.log(
    `[dots] Turn Summary | Total Time: ${turnTotalTimeMs}ms | Steps: ${totalSteps} | Total Prompt Tokens: ${turnPromptTokens}`
  );
  repo.addMessage({ dotId: dot.id, role: "system", text: `Stopped after ${MAX_STEPS} steps. Say "continue" to keep going.` });
}

async function respond(dot: Dot, messages: ChatMessage[], trigger: Trigger, signal: AbortSignal, omitTools = false): Promise<ChatMessage> {
  const modelName = await activeModel(dot.model);
  const provider = getProvider();

  const toolDefs: ToolDefinition[] = omitTools
    ? []
    : toolsForDot(dot).map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as ToolDefinition["function"]["parameters"],
        },
      }));

  const systemMsg: ChatMessage = {
    role: "system",
    content: systemPrompt(dot, trigger),
  };

  const fullMessages = [systemMsg, ...messages];

  repo.setActivity(dot.id, "Thinking");

  let draftMessageId: string | null = null;
  let accumulatedText = "";

  const responseMsg = await provider.chatStream(
    {
      model: modelName,
      messages: fullMessages,
      tools: toolDefs.length ? toolDefs : undefined,
      temperature: 0.2,
      context_length: 8192,
    },
    (chunk) => {
      if (chunk.delta?.content) {
        if (!draftMessageId) {
          const m = repo.addMessage({ dotId: dot.id, role: "dot", text: "" });
          draftMessageId = m.id;
        }
        accumulatedText += chunk.delta.content;
        emit({ type: "message_delta", id: draftMessageId, dotId: dot.id, delta: chunk.delta.content });
      }
    },
    signal
  );

  if (draftMessageId) {
    repo.updateMessage(draftMessageId, { text: accumulatedText || "…" });
  }

  return responseMsg;
}

async function processCalls(dot: Dot, pending: Pending, signal: AbortSignal, seenCalls: Set<string>): Promise<boolean> {
  for (; pending.index < pending.calls.length; pending.index++) {
    signal.throwIfAborted();
    savePending(dot.id, pending);
    const call = pending.calls[pending.index];

    const callKey = `${call.function.name}:${call.function.arguments}`;
    if (seenCalls.has(callKey)) {
      pending.outputs.push({
        role: "tool",
        name: call.function.name,
        tool_call_id: call.id,
        content: "Tool already executed with these exact parameters",
      });
      continue;
    }
    seenCalls.add(callKey);

    const def = findTool(call.function.name);
    const args = safeParse(call.function.arguments);

    if (!def) {
      pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: `Unknown tool ${call.function.name}` });
      continue;
    }

    if (def.pause === "question") {
      return pauseFor(dot, pending, { kind: "question", status: "pending", title: String(args.question ?? ""), options: (args.options as string[]) ?? [] });
    }
    if (def.pause === "approval") {
      return pauseFor(dot, pending, { kind: "approval", status: "pending", title: String(args.action ?? ""), detail: String(args.details ?? ""), tool: def.name });
    }

    if (def.pause === "connect") {
      const toolkit = String(args.toolkit ?? "").trim().toLowerCase();
      const started = await composio.startConnect(toolkit).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
      if ("error" in started) {
        pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: `Couldn't start connecting ${toolkit}: ${started.error}` });
        continue;
      }
      if (started.already) {
        pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: "Already connected." });
        continue;
      }
      pauseFor(dot, pending, {
        kind: "connect", status: "pending", title: `Connect ${started.name}`, toolkit, url: started.url,
        detail: `${dot.name} needs access to your ${started.name} to continue. You'll sign in with ${started.name} directly; ${dot.name} never sees your password.`,
      });
      const cardId = pending.cardId!;
      void started.wait().then(() => resolveCard(cardId, "approve")).catch(() => {});
      return true;
    }

    const ctx: ToolCtx = { dot, signal, depth: 0 };
    const blocked = await def.precheck?.(args, ctx).catch(() => null);
    if (blocked) {
      pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: blocked });
      continue;
    }

    if (def.describe) {
      const action = def.describe(args, ctx);
      repo.setActivity(dot.id, "Checking your rules");
      const verdict = await review(dot.id, action, (await def.defaultDecision?.(ctx, args)) ?? "allow");
      if (verdict.decision === "never") {
        activity(dot.id, "Blocked by your rule", verdict.rule?.action);
        pending.outputs.push({
          role: "tool",
          name: call.function.name,
          tool_call_id: call.id,
          content: `Not allowed: the user's rule says never ${verdict.rule?.action ?? "do this"}. Don't try to work around it.`,
        });
        continue;
      }
      if (verdict.decision === "ask") {
        return pauseFor(dot, pending, {
          kind: "approval", status: "pending", title: capitalize(action), tool: def.name, ruleAction: verdict.rule?.action ?? action,
          detail: [def.detail?.(args), verdict.rule ? `Your rule: ask first when it wants to ${verdict.rule.action}.` : null].filter(Boolean).join("\n\n") || undefined,
        });
      }
    }

    const outputText = await execTool(dot, call, signal);
    pending.outputs.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: outputText });
  }
  savePending(dot.id, pending);
  return false;
}

function pauseFor(dot: Dot, pending: Pending, card: CardData): true {
  const msg = repo.addMessage({ dotId: dot.id, role: "card", text: card.title, card });
  pending.cardId = msg.id;
  savePending(dot.id, pending);
  return true;
}

async function execTool(dot: Dot, call: FunctionToolCall, signal: AbortSignal): Promise<string> {
  const def = findTool(call.function.name)!;
  const args = safeParse(call.function.arguments);
  repo.setActivity(dot.id, def.label);
  activity(dot.id, def.label, summarize(args));
  try {
    return await def.execute!(args, { dot, signal, depth: 0 });
  } catch (err) {
    if (signal.aborted) throw err;
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function rebuildContextMessages(dotId: string, exclude: string): ChatMessage[] {
  return repo
    .conversationMessages(repo.currentConversation(dotId), 15)
    .filter((m) => (m.role === "user" || m.role === "dot") && m.text && m.text !== exclude)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text.slice(0, 2500) }));
}

// ---------------------------------------------------------------- dot-to-dot

setConsult(async (target, message, from, _depth, signal) => {
  const channelId = repo.channelRoute(from.id);
  if (!channelId) repo.addMessage({ dotId: target.id, role: "user", text: message, from: `dot:${from.name}` });
  repo.setActivity(target.id, `Helping ${from.name}`);
  try {
    const provider = getProvider();
    const targetModel = await activeModel(target.model);

    const res = await provider.chat(
      {
        model: targetModel,
        messages: [
          { role: "system", content: systemPrompt(target, { kind: "dot", from: from.name }) },
          ...rebuildContextMessages(target.id, message).slice(-12),
          { role: "user", content: `${from.name} asks: ${message}` },
        ],
        temperature: 0.2,
      },
      signal
    );

    const reply = res.message.content || "(no reply)";
    repo.addMessage({ dotId: target.id, role: "dot", text: reply, from: `dot:${from.name}`, channelId });
    return `${target.name} replied: ${reply}`;
  } finally {
    repo.setActivity(target.id, null);
  }
});

// ---------------------------------------------------------------- helpers

function userInput(dotId: string, text: string, attachments: Attachment[], maxEvidenceTokens = 2500): ChatMessage {
  if (!attachments.length) return { role: "user", content: text };

  let pdfContext = "";
  for (const a of attachments) {
    if (a.mime === "application/pdf" || a.name.toLowerCase().endsWith(".pdf")) {
      const taskId = `task_${a.id}`;
      const chunks = getTaskChunks(taskId);
      if (chunks.length > 0) {
        let currentTokens = 0;
        const selectedChunks: typeof chunks = [];
        for (const c of chunks) {
          const chunkTokens = Math.ceil(c.text.length / 4);
          if (currentTokens + chunkTokens > maxEvidenceTokens && selectedChunks.length > 0) {
            break;
          }
          selectedChunks.push(c);
          currentTokens += chunkTokens;
        }

        const overflowCount = chunks.length - selectedChunks.length;
        const overflowNotice = overflowCount > 0
          ? `\n\n[Note to Model: ${overflowCount} additional chunks (${chunks.length} total) from ${a.name} are stored locally in SQLite chunk_store database and can be recalled]`
          : "";

        pdfContext += `\n\n[Attached PDF Content (${a.name}) - Evidence Budget: ~${currentTokens}/${maxEvidenceTokens} tokens (${selectedChunks.length}/${chunks.length} chunks included)]:\n` +
          selectedChunks.map((c, i) => `--- Chunk ${i + 1} (Page ${c.page ?? "?"}) ---\n${c.text}`).join("\n\n") +
          overflowNotice;
      }
    }
  }

  const note = `\n\n[Attached: ${attachments.map((a) => `${a.name} (saved in workspace at ${files.boxPathOf(a.id) ?? `uploads/${a.name}`})`).join("; ")}]`;
  return { role: "user", content: (text || "See attached files.") + note + pdfContext };
}

function activity(dotId: string, label: string, detail?: string) {
  const last = repo.dotMessages(dotId, 1)[0];
  const text = detail ? `${label} · ${detail}` : label;
  if (last?.role === "activity" && last.text === text) return;
  repo.addMessage({ dotId, role: "activity", text });
}

function summarize(a: Record<string, unknown>): string | undefined {
  const v = a.command ?? a.url ?? a.path ?? a.site ?? a.fact ?? a.name ?? a.dot_name;
  if (typeof v !== "string") return undefined;
  return v.length > 80 ? v.slice(0, 77) + "…" : v;
}

function savePending(dotId: string, pending: Pending) {
  repo.setThread(dotId, pending.responseId, JSON.stringify(pending));
}

function parsePending(raw: string | null): Pending | null {
  return raw ? (JSON.parse(raw) as Pending) : null;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
