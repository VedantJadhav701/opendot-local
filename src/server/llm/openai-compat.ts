import "server-only";
import type { ChatChunk, ChatMessage, ChatRequest, FunctionToolCall, LLMProvider, ModelInfo } from "./types";
import { getSetting, setSetting } from "../db";

export type OpenAICompatConfig = {
  baseUrl?: string;
  apiKey?: string | (() => string | null | Promise<string | null>);
  model?: string;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  timeoutMs?: number;
};

export class OpenAICompatProvider implements LLMProvider {
  name = "openai-compat";
  private config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature ?? 0.2,
      max_tokens: config.max_tokens ?? 1024,
      reasoning_effort: config.reasoning_effort || "low",
      timeoutMs: config.timeoutMs ?? (process.env.CLOUD_TIMEOUT_MS ? parseInt(process.env.CLOUD_TIMEOUT_MS, 10) : 60_000),
    };
  }

  private async getApiKey(): Promise<string | null> {
    if (typeof this.config.apiKey === "function") {
      return this.config.apiKey();
    }
    return this.config.apiKey || process.env.OPENAI_API_KEY || null;
  }

  private getBaseUrl(): string {
    let url = this.config.baseUrl || "https://api.openai.com/v1";
    return url.replace(/\/$/, "");
  }

  async health(): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${this.getBaseUrl()}/models`, { method: "GET", headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const apiKey = await this.getApiKey();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${this.getBaseUrl()}/models`, { method: "GET", headers });
      if (!res.ok) return [];

      const data = (await res.json()) as { data?: Array<{ id: string; created?: number }> };
      if (!Array.isArray(data.data)) return [];

      return data.data.map((m) => ({
        id: m.id,
        name: m.id,
      }));
    } catch {
      return [];
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<{ message: ChatMessage; finishReason: string }> {
    return this.executeChat(req, false, signal);
  }

  async chatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    return this.executeChatStream(req, onChunk, false, signal);
  }

  private async executeChat(
    req: ChatRequest,
    retryWithoutTools = false,
    signal?: AbortSignal
  ): Promise<{ message: ChatMessage; finishReason: string }> {
    const apiKey = await this.getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const model = req.model || this.config.model || "moonshotai/kimi-k3";
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(req.messages),
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: this.config.max_tokens,
      stream: false,
    };

    if (this.config.reasoning_effort) {
      body.reasoning_effort = this.config.reasoning_effort;
    }

    const disableTools = retryWithoutTools || getSetting(`no_tool_support_${model}`) === "true";
    if (req.tools && req.tools.length > 0 && !disableTools) {
      body.tools = req.tools;
    }

    const isDebug = process.env.DEBUG_CLOUD === "1";
    if (isDebug) {
      const debugHeaders = { ...headers, Authorization: headers["Authorization"] ? "Bearer [REDACTED]" : undefined };
      console.log(`[DEBUG_CLOUD] POST ${this.getBaseUrl()}/chat/completions`);
      console.log(`[DEBUG_CLOUD] Headers:`, JSON.stringify(debugHeaders));
      console.log(`[DEBUG_CLOUD] Body:`, JSON.stringify(body));
    }

    const timeoutMs = this.config.timeoutMs || 60_000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`Cloud API timeout after ${timeoutMs / 1000}s (no response from provider)`));
    }, timeoutMs);

    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (controller.signal.aborted) {
        throw new Error(`Cloud API timeout after ${timeoutMs / 1000}s (no response from provider)`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
    }

    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") || res.headers.get("x-retry-after") || "none";
      const requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || "none";
      const errText = (await res.text().catch(() => "")).slice(0, 500);

      console.error(`[openai-compat] Non-2xx HTTP ${res.status} | RequestID: ${requestId} | Retry-After: ${retryAfter} | Body: ${errText}`);

      if (res.status === 400 && req.tools && req.tools.length > 0 && !retryWithoutTools) {
        const lowerErr = errText.toLowerCase();
        if (lowerErr.includes("tool") || lowerErr.includes("function") || lowerErr.includes("unsupported")) {
          console.warn(`[openai-compat] Model '${model}' failed with tools (HTTP 400). Marking 'no tool support' and retrying without tools.`);
          setSetting(`no_tool_support_${model}`, "true");
          return this.executeChat(req, true, signal);
        }
      }

      throw new Error(`OpenAI-Compat API error (HTTP ${res.status}${requestId !== "none" ? `, req_id=${requestId}` : ""}): ${errText}`);
    }

    const data = (await res.json()) as any;
    if (isDebug) {
      console.log(`[DEBUG_CLOUD] Response Data:`, JSON.stringify(data));
    }

    const choice = data.choices?.[0];
    const totalMs = Date.now() - startMs;

    let content = choice?.message?.content || "";
    const reasoningText = choice?.message?.reasoning_content || choice?.message?.reasoning || "";

    // If content is empty but reasoning exists, use reasoning as visible fallback content
    if (!content.trim() && reasoningText.trim()) {
      content = this.stripThinking(reasoningText);
    } else {
      content = this.stripThinking(content);
    }

    if (!content.trim()) {
      content = "[Cloud provider returned an empty response]";
    }

    const toolCalls: FunctionToolCall[] = (choice?.message?.tool_calls || []).map((tc: any) => ({
      id: tc.id || `call_${Date.now()}`,
      type: "function",
      function: {
        name: tc.function?.name || "",
        arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
      },
    }));

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    console.log(`[openai-compat] Chat Complete | model: ${model} | prompt_tokens: ${promptTokens}, completion_tokens: ${completionTokens}, totalMs: ${totalMs}ms`);

    const message: ChatMessage = {
      role: "assistant",
      content,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      metrics: {
        ttftMs: totalMs,
        totalTimeMs: totalMs,
        promptTokens,
        completionTokens,
      },
    };

    return { message, finishReason: choice?.finish_reason || "stop" };
  }

  private async executeChatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    retryWithoutTools = false,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const apiKey = await this.getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const model = req.model || this.config.model || "moonshotai/kimi-k3";
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(req.messages),
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: this.config.max_tokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (this.config.reasoning_effort) {
      body.reasoning_effort = this.config.reasoning_effort;
    }

    const disableTools = retryWithoutTools || getSetting(`no_tool_support_${model}`) === "true";
    if (req.tools && req.tools.length > 0 && !disableTools) {
      body.tools = req.tools;
    }

    const isDebug = process.env.DEBUG_CLOUD === "1";
    if (isDebug) {
      const debugHeaders = { ...headers, Authorization: headers["Authorization"] ? "Bearer [REDACTED]" : undefined };
      console.log(`[DEBUG_CLOUD] POST (stream) ${this.getBaseUrl()}/chat/completions`);
      console.log(`[DEBUG_CLOUD] Headers:`, JSON.stringify(debugHeaders));
      console.log(`[DEBUG_CLOUD] Body:`, JSON.stringify(body));
    }

    const timeoutMs = this.config.timeoutMs || 60_000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`Cloud API timeout after ${timeoutMs / 1000}s (no response from provider)`));
    }, timeoutMs);

    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (controller.signal.aborted) {
        throw new Error(`Cloud API timeout after ${timeoutMs / 1000}s (no response from provider)`);
      }
      throw err;
    }

    if (!res.ok) {
      clearTimeout(timeoutTimer);
      const retryAfter = res.headers.get("retry-after") || res.headers.get("x-retry-after") || "none";
      const requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || "none";
      const errText = (await res.text().catch(() => "")).slice(0, 500);

      console.error(`[openai-compat] Non-2xx HTTP ${res.status} | RequestID: ${requestId} | Retry-After: ${retryAfter} | Body: ${errText}`);

      if (res.status === 400 && req.tools && req.tools.length > 0 && !retryWithoutTools) {
        const lowerErr = errText.toLowerCase();
        if (lowerErr.includes("tool") || lowerErr.includes("function") || lowerErr.includes("unsupported")) {
          console.warn(`[openai-compat] Model '${model}' failed streaming with tools (HTTP 400). Marking 'no tool support' and retrying without tools.`);
          setSetting(`no_tool_support_${model}`, "true");
          return this.executeChatStream(req, onChunk, true, signal);
        }
      }

      throw new Error(`OpenAI-Compat API stream error (HTTP ${res.status}${requestId !== "none" ? `, req_id=${requestId}` : ""}): ${errText}`);
    }

    let ttftMs = 0;
    let accumulatedText = "";
    let accumulatedReasoning = "";
    let inThinkTag = false;
    let buffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      clearTimeout(timeoutTimer);
      throw new Error("No response body to stream");
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (ttftMs === 0) {
          ttftMs = Date.now() - startMs;
          clearTimeout(timeoutTimer); // first byte received, clear initial timeout
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (isDebug && trimmed) {
            console.log(`[DEBUG_CLOUD] SSE chunk: ${trimmed}`);
          }
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || promptTokens;
              completionTokens = parsed.usage.completion_tokens || completionTokens;
            }

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            const reasoningDelta = delta.reasoning_content || delta.reasoning || "";
            if (reasoningDelta) {
              accumulatedReasoning += reasoningDelta;
            }

            let rawContent = delta.content || "";

            if (rawContent.includes("<think>")) {
              inThinkTag = true;
              const parts = rawContent.split("<think>");
              rawContent = parts[0];
              accumulatedReasoning += parts[1] || "";
            }
            if (inThinkTag) {
              if (rawContent.includes("</think>")) {
                inThinkTag = false;
                const parts = rawContent.split("</think>");
                accumulatedReasoning += parts[0];
                rawContent = parts[1] || "";
              } else {
                accumulatedReasoning += rawContent;
                rawContent = "";
              }
            }

            if (rawContent) {
              accumulatedText += rawContent;
              onChunk({ delta: { content: rawContent } });
            }
          } catch {
            // ignore stream parse errors
          }
        }
      }
    } finally {
      clearTimeout(timeoutTimer);
    }

    // Fallback: If content was empty but reasoning content was streamed, use reasoning as visible content
    if (!accumulatedText.trim() && accumulatedReasoning.trim()) {
      accumulatedText = this.stripThinking(accumulatedReasoning);
      onChunk({ delta: { content: accumulatedText } });
    }

    if (!accumulatedText.trim()) {
      accumulatedText = "[Cloud provider returned an empty response]";
      onChunk({ delta: { content: accumulatedText } });
    }

    const totalTimeMs = Date.now() - startMs;
    console.log(`[openai-compat] SSE Stream Complete | model: ${model} | prompt_tokens: ${promptTokens}, completion_tokens: ${completionTokens}, ttftMs: ${ttftMs}ms, totalMs: ${totalTimeMs}ms`);

    return {
      role: "assistant",
      content: accumulatedText,
      metrics: {
        ttftMs: ttftMs || totalTimeMs,
        totalTimeMs,
        promptTokens,
        completionTokens,
      },
    };
  }

  private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort(signal1.reason || signal2.reason);
    };
    if (signal1.aborted || signal2.aborted) {
      onAbort();
    } else {
      signal1.addEventListener("abort", onAbort, { once: true });
      signal2.addEventListener("abort", onAbort, { once: true });
    }
    return controller.signal;
  }

  private formatMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      const formatted: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      };
      if (m.name) formatted.name = m.name;
      if (m.tool_call_id) formatted.tool_call_id = m.tool_call_id;
      if (m.tool_calls) formatted.tool_calls = m.tool_calls;
      return formatted;
    });
  }

  private stripThinking(text: string): string {
    let clean = text || "";
    if (clean.includes("<think>")) {
      clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }
    return clean;
  }
}
