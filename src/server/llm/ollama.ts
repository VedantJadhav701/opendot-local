import type { ChatChunk, ChatMessage, ChatRequest, FunctionToolCall, LLMProvider, ModelInfo } from "./types";

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

    await this.chatStream(
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
      message: {
        role: "assistant",
        content: fullText,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finishReason,
    };
  }

  public async chatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
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
    };
    if (typeof req.temperature === "number") {
      optionsObj.temperature = req.temperature;
    }
    body.options = optionsObj;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body received from Ollama");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = "";
    const accumulatedToolCalls: FunctionToolCall[] = [];
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

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
            };

            if (parsed.message?.content) {
              accumulatedText += parsed.message.content;
              onChunk({ delta: { content: parsed.message.content } });
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

            if (parsed.done) {
              onChunk({ finishReason: parsed.done_reason || "stop" });
            }
          } catch {
            // Ignore incomplete line parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      role: "assistant",
      content: accumulatedText,
      ...(accumulatedToolCalls.length > 0 ? { tool_calls: accumulatedToolCalls } : {}),
    };
  }
}

function safeJsonParse(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}
