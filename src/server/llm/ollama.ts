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

export type QueueTask<T> = {
  fn: (queueWaitMs: number) => Promise<T>;
  resolve: (val: T) => void;
  reject: (err: unknown) => void;
  enqueueTime: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

const gQueue = globalThis as unknown as { __llmQueue?: QueueTask<any>[]; __isProcessingLLMQueue?: boolean };
export const queue: QueueTask<any>[] = (gQueue.__llmQueue ??= []);

const DEFAULT_CONTEXT_LENGTH = 8192;
const MAX_CONTEXT_LENGTH = 8192;
const DEFAULT_NUM_PREDICT = 384;

export function enqueueLLMRequest<T>(
  fn: (queueWaitMs: number) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 120_000
): Promise<T> {
  const enqueueTime = Date.now();
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const task: QueueTask<T> = {
      fn,
      resolve: (val) => {
        if (timer) clearTimeout(timer);
        if (task.abortHandler && signal) signal.removeEventListener("abort", task.abortHandler);
        resolve(val);
      },
      reject: (err) => {
        if (timer) clearTimeout(timer);
        if (task.abortHandler && signal) signal.removeEventListener("abort", task.abortHandler);
        reject(err);
      },
      enqueueTime,
      signal,
    };

    if (signal) {
      if (signal.aborted) {
        return reject(signal.reason || new Error("Aborted before enqueue"));
      }
      const abortHandler = () => {
        const idx = queue.indexOf(task);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        task.reject(signal.reason || new Error("Request aborted while in queue"));
      };
      task.abortHandler = abortHandler;
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const idx = queue.indexOf(task);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        task.reject(new Error(`LLM Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    queue.push(task);
    processLLMQueue();
  });
}

async function processLLMQueue() {
  if (gQueue.__isProcessingLLMQueue || queue.length === 0) return;
  gQueue.__isProcessingLLMQueue = true;
  const task = queue.shift()!;
  const queueWaitMs = Date.now() - task.enqueueTime;

  let hungTimeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    hungTimeout = setTimeout(() => {
      reject(new Error("LLM Task execution hung - forced queue unlock"));
    }, 120_000);
  });

  try {
    const res = await Promise.race([task.fn(queueWaitMs), timeoutPromise]);
    task.resolve(res);
  } catch (err) {
    task.reject(err);
  } finally {
    if (hungTimeout) clearTimeout(hungTimeout);
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

  public async pullModel(model: string, onProgress?: (completed: number, total: number) => void): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (!response.ok) throw new Error(`Ollama could not download ${model} (${response.status}).`);
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      for (const line of buffer.split("\n").slice(0, -1)) {
        try {
          const item = JSON.parse(line) as { completed?: number; total?: number; error?: string };
          if (item.error) throw new Error(item.error);
          if (item.completed !== undefined && item.total) onProgress?.(item.completed, item.total);
        } catch (error) {
          if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
        }
      }
      buffer = buffer.split("\n").pop() ?? "";
      if (done) break;
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

      const requestedContext =
        req.context_length ||
        Number(process.env.DOTS_CONTEXT_LENGTH || DEFAULT_CONTEXT_LENGTH);

      const targetNumCtx = Math.min(
        Math.max(2048, requestedContext),
        MAX_CONTEXT_LENGTH
      );

      const optionsObj: Record<string, unknown> = {
        num_ctx: targetNumCtx,
        num_predict: req.num_predict ?? Number(process.env.DOTS_NUM_PREDICT || DEFAULT_NUM_PREDICT),
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

      const executeRequest = (ctxSize: number): Promise<void> => {
        (body.options as Record<string, unknown>).num_ctx = ctxSize;
        return new Promise<void>((resolve, reject) => {
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
                res.on("end", () => {
                  if (
                    errText.includes("exceed_context_size_error") ||
                    errText.includes("exceeds the available context size")
                  ) {
                    reject(
                      new Error(
                        `Ollama context limit exceeded at num_ctx=${ctxSize}. Reduce prompt/context size instead of increasing context.`
                      )
                    );
                    return;
                  }
                  reject(new Error(`Ollama error (${res.statusCode}): ${errText}`));
                });
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
    };

    await executeRequest(targetNumCtx);

      const totalTimeMs = Date.now() - startTime;
      if (ttftMs === 0) ttftMs = totalTimeMs;

      let cleanText = stripThinking(accumulatedText);
      if (accumulatedToolCalls.length === 0) {
        const extracted = extractToolCallsFromText(cleanText);
        cleanText = extracted.cleanText;
        if (extracted.toolCalls.length > 0) {
          accumulatedToolCalls.push(...extracted.toolCalls);
        }
      }

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
    }, signal);
  }
}

function safeJsonParse(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

function extractToolCallsFromText(text: string): { cleanText: string; toolCalls: FunctionToolCall[] } {
  const toolCalls: FunctionToolCall[] = [];
  let cleanText = text;

  const regex = /<tool_call>\s*({[\s\S]*?})(?:\s*<\/tool_call>|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 9)}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === "string" ? safeJsonParse(parsed.arguments) : (parsed.arguments || {}),
          },
        });
      }
    } catch {
      // Ignore parse failure
    }
  }

  if (toolCalls.length > 0) {
    cleanText = cleanText.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, "").trim();
  }

  return { cleanText, toolCalls };
}
