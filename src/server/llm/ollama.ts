import "server-only";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { ChatChunk, ChatMessage, ChatRequest, FunctionToolCall, LLMProvider, ModelInfo } from "./types";

export function stripThinking(text: string): string {
  if (!text) return "";
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (clean.includes("</think>")) {
    clean = clean.split("</think>").pop() || "";
  }
  return clean;
}

export class ThinkStreamFilter {
  private inThinkMode = false;
  private buffer = "";

  public process(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer.length > 0) {
      if (this.inThinkMode) {
        const endIdx = this.buffer.toLowerCase().indexOf("</think>");
        if (endIdx !== -1) {
          this.inThinkMode = false;
          this.buffer = this.buffer.slice(endIdx + 8);
        } else {
          const partialClose = this.getPartialMatch(this.buffer, "</think>");
          if (partialClose > 0) {
            this.buffer = this.buffer.slice(-partialClose);
          } else {
            this.buffer = "";
          }
          break;
        }
      } else {
        const startIdx = this.buffer.toLowerCase().indexOf("<think>");
        if (startIdx !== -1) {
          output += this.buffer.slice(0, startIdx);
          this.inThinkMode = true;
          this.buffer = this.buffer.slice(startIdx + 7);
        } else {
          const partialOpen = this.getPartialMatch(this.buffer, "<think>");
          if (partialOpen > 0) {
            output += this.buffer.slice(0, this.buffer.length - partialOpen);
            this.buffer = this.buffer.slice(-partialOpen);
            break;
          } else {
            output += this.buffer;
            this.buffer = "";
          }
        }
      }
    }

    return output;
  }

  public flush(): string {
    if (this.inThinkMode) {
      this.buffer = "";
      return "";
    }
    const rem = this.buffer;
    this.buffer = "";
    return rem;
  }

  private getPartialMatch(str: string, target: string): number {
    const lowerStr = str.toLowerCase();
    const lowerTarget = target.toLowerCase();
    for (let len = Math.min(str.length, target.length - 1); len > 0; len--) {
      if (lowerStr.endsWith(lowerTarget.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }
}

type QueueTask<T> = {
  fn: (queueWaitMs: number) => Promise<T>;
  resolve: (val: T) => void;
  reject: (err: unknown) => void;
  enqueueTime: number;
};

const gQueue = globalThis as unknown as { __llmQueue?: QueueTask<any>[]; __isProcessingLLMQueue?: boolean };
const queue: QueueTask<any>[] = (gQueue.__llmQueue ??= []);

function enqueueLLMRequest<T>(fn: (queueWaitMs: number) => Promise<T>): Promise<T> {
  const enqueueTime = Date.now();
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject, enqueueTime });
    processLLMQueue();
  });
}

async function processLLMQueue() {
  if (gQueue.__isProcessingLLMQueue || queue.length === 0) return;
  gQueue.__isProcessingLLMQueue = true;
  const task = queue.shift()!;
  const queueWaitMs = Date.now() - task.enqueueTime;
  try {
    const res = await task.fn(queueWaitMs);
    task.resolve(res);
  } catch (err) {
    task.reject(err);
  } finally {
    gQueue.__isProcessingLLMQueue = false;
    processLLMQueue();
  }
}

export class OllamaProvider implements LLMProvider {
  public name = "ollama";
  private baseUrl: string;

  constructor(host?: string) {
    const rawHost = host || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
    this.baseUrl = rawHost.replace(/\/$/, "");
  }

  public getHost(): string {
    return this.baseUrl;
  }

  public async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
      if (!data.models) return [];
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
        size: m.size,
        modified_at: m.modified_at,
      }));
    } catch {
      return [];
    }
  }

  public async chat(req: ChatRequest, signal?: AbortSignal): Promise<{ message: ChatMessage; finishReason: string }> {
    let fullText = "";
    let toolCalls: FunctionToolCall[] = [];
    let finishReason = "stop";

    const msg = await this.chatStream(
      req,
      (chunk) => {
        if (chunk.delta?.content) {
          fullText += chunk.delta.content;
        }
        if (chunk.delta?.tool_calls) {
          for (const tc of chunk.delta.tool_calls) {
            if (tc.function?.name) {
              toolCalls.push({
                id: tc.id || `call_${Math.random().toString(36).substring(2, 9)}`,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments || "{}",
                },
              });
            }
          }
        }
        if (chunk.finishReason) {
          finishReason = chunk.finishReason;
        }
      },
      signal
    );

    return {
      message: msg,
      finishReason,
    };
  }

  public async chatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    return enqueueLLMRequest(async (queueWaitMs) => {
      const formattedMessages = req.messages.map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content || "",
        };
        if (m.name) msg.name = m.name;
        if (m.tool_calls && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls.map((tc) => ({
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === "string" ? safeJsonParse(tc.function.arguments) : tc.function.arguments,
            },
          }));
        }
        return msg;
      });

      const body: Record<string, unknown> = {
        model: req.model,
        messages: formattedMessages,
        stream: true,
        think: false,
        keep_alive: "30m",
      };

      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        }));
      }

      const optionsObj: Record<string, unknown> = {
        num_ctx: req.context_length || 8192,
        num_predict: Number(process.env.DOTS_NUM_PREDICT || 600),
      };
      if (typeof req.temperature === "number") {
        optionsObj.temperature = req.temperature;
      }
      body.options = optionsObj;

      const startTime = Date.now();
      let ttftMs = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let accumulatedText = "";
      const accumulatedToolCalls: FunctionToolCall[] = [];
      let buffer = "";
      const thinkFilter = new ThinkStreamFilter();

      await new Promise<void>((resolve, reject) => {
        const targetUrl = new URL(`${this.baseUrl}/api/chat`);
        const transport = targetUrl.protocol === "https:" ? https : http;
        const bodyStr = JSON.stringify(body);

        const request = transport.request(
          targetUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(bodyStr),
            },
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 400) {
              let errText = "";
              res.on("data", (c) => (errText += c));
              res.on("end", () => reject(new Error(`Ollama error (${res.statusCode}): ${errText}`)));
              return;
            }

            res.setEncoding("utf8");
            res.on("data", (chunkData: string) => {
              buffer += chunkData;
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                  const parsed = JSON.parse(trimmed) as {
                    message?: {
                      content?: string;
                      tool_calls?: Array<{
                        function?: {
                          name?: string;
                          arguments?: Record<string, unknown> | string;
                        };
                      }>;
                    };
                    done?: boolean;
                    done_reason?: string;
                    prompt_eval_count?: number;
                    eval_count?: number;
                  };

                  if (parsed.message?.content || (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0)) {
                    if (ttftMs === 0) {
                      ttftMs = Date.now() - startTime;
                    }
                  }

                  if (parsed.message?.content) {
                    const filteredContent = thinkFilter.process(parsed.message.content);
                    if (filteredContent) {
                      accumulatedText += filteredContent;
                      onChunk({ delta: { content: filteredContent } });
                    }
                  }

                  if (parsed.message?.tool_calls) {
                    for (const tc of parsed.message.tool_calls) {
                      if (tc.function?.name) {
                        const callId = `call_${Math.random().toString(36).substring(2, 9)}`;
                        const argsStr =
                          typeof tc.function.arguments === "string"
                            ? tc.function.arguments
                            : JSON.stringify(tc.function.arguments || {});

                        const toolCall: FunctionToolCall = {
                          id: callId,
                          type: "function",
                          function: {
                            name: tc.function.name,
                            arguments: argsStr,
                          },
                        };

                        accumulatedToolCalls.push(toolCall);
                        onChunk({
                          delta: {
                            tool_calls: [
                              {
                                id: callId,
                                type: "function",
                                function: {
                                  name: tc.function.name,
                                  arguments: argsStr,
                                },
                              },
                            ],
                          },
                        });
                      }
                    }
                  }

                  if (typeof parsed.prompt_eval_count === "number") promptTokens = parsed.prompt_eval_count;
                  if (typeof parsed.eval_count === "number") completionTokens = parsed.eval_count;

                  if (parsed.done) {
                    const flushed = thinkFilter.flush();
                    if (flushed) {
                      accumulatedText += flushed;
                      onChunk({ delta: { content: flushed } });
                    }
                    onChunk({ finishReason: parsed.done_reason || "stop" });
                  }
                } catch {
                  // Ignore incomplete line parse errors
                }
              }
            });

            res.on("end", () => resolve());
            res.on("error", (err) => reject(err));
          }
        );

        request.on("error", (err) => reject(err));

        if (signal) {
          signal.addEventListener("abort", () => {
            request.destroy();
            reject(signal.reason || new Error("Aborted"));
          });
        }

        request.write(bodyStr);
        request.end();
      });

      const totalTimeMs = Date.now() - startTime;
      if (ttftMs === 0) ttftMs = totalTimeMs;

      const cleanText = stripThinking(accumulatedText);

      return {
        role: "assistant",
        content: cleanText,
        ...(accumulatedToolCalls.length > 0 ? { tool_calls: accumulatedToolCalls } : {}),
        metrics: {
          queueWaitMs,
          ttftMs,
          totalTimeMs,
          promptTokens,
          completionTokens,
        },
      };
    });
  }
}

function safeJsonParse(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}
