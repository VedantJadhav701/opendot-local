import "server-only";
import type { ChatChunk, ChatMessage, ChatRequest, FunctionToolCall, LLMProvider, ModelInfo } from "./types";

export type OpenAICompatConfig = {
  baseUrl?: string;
  apiKey?: string | (() => string | null | Promise<string | null>);
  model?: string;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
};

export class OpenAICompatProvider implements LLMProvider {
  name = "openai-compat";
  private config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || "https://integrate.api.nvidia.com/v1",
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature ?? 0.2,
      max_tokens: config.max_tokens ?? 1024,
      reasoning_effort: config.reasoning_effort || "low",
    };
  }

  private async getApiKey(): Promise<string | null> {
    if (typeof this.config.apiKey === "function") {
      return this.config.apiKey();
    }
    return this.config.apiKey || process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || null;
  }

  private getBaseUrl(): string {
    let url = this.config.baseUrl || "https://integrate.api.nvidia.com/v1";
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
    const apiKey = await this.getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const model = req.model || this.config.model || "meta/llama-3.1-70b-instruct";
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

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
    }

    const startMs = Date.now();
    const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI-Compat API error (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    const totalMs = Date.now() - startMs;

    let content = choice?.message?.content || "";
    // Strip reasoning / thinking fields
    content = this.stripReasoning(content, choice?.message?.reasoning_content || choice?.message?.reasoning);

    const toolCalls: FunctionToolCall[] = (choice?.message?.tool_calls || []).map((tc: any) => ({
      id: tc.id || `call_${Date.now()}`,
      type: "function",
      function: {
        name: tc.function?.name || "",
        arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {}),
      },
    }));

    const message: ChatMessage = {
      role: "assistant",
      content,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      metrics: {
        ttftMs: totalMs,
        totalTimeMs: totalMs,
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
      },
    };

    return { message, finishReason: choice?.finish_reason || "stop" };
  }

  async chatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const apiKey = await this.getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const model = req.model || this.config.model || "meta/llama-3.1-70b-instruct";
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(req.messages),
      temperature: req.temperature ?? this.config.temperature,
      max_tokens: this.config.max_tokens,
      stream: true,
    };

    if (this.config.reasoning_effort) {
      body.reasoning_effort = this.config.reasoning_effort;
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
    }

    const startMs = Date.now();
    const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI-Compat API stream error (HTTP ${res.status}): ${errText}`);
    }

    let ttftMs = 0;
    let accumulatedText = "";
    let inThinkTag = false;
    let buffer = "";

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error("No response body to stream");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (ttftMs === 0) ttftMs = Date.now() - startMs;

          let rawContent = delta.content || "";
          // Filter out reasoning content or <think> tags in stream
          if (delta.reasoning_content || delta.reasoning) {
            continue; // strip reasoning delta
          }

          if (rawContent.includes("<think>")) {
            inThinkTag = true;
            rawContent = rawContent.split("<think>")[0];
          }
          if (inThinkTag) {
            if (rawContent.includes("</think>")) {
              inThinkTag = false;
              rawContent = rawContent.split("</think>")[1] || "";
            } else {
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

    const totalTimeMs = Date.now() - startMs;

    return {
      role: "assistant",
      content: accumulatedText,
      metrics: {
        ttftMs: ttftMs || totalTimeMs,
        totalTimeMs,
        promptTokens: 0,
        completionTokens: 0,
      },
    };
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

  private stripReasoning(text: string, explicitReasoning?: string): string {
    let clean = text || "";
    if (clean.includes("<think>")) {
      clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }
    return clean;
  }
}
