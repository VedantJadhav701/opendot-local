export type Role = "system" | "user" | "assistant" | "tool";

export type FunctionToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
};

export type StepMetrics = {
  queueWaitMs?: number;
  ttftMs: number;
  totalTimeMs: number;
  promptTokens: number;
  completionTokens: number;
};

export type ChatMessage = {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: FunctionToolCall[];
  metrics?: StepMetrics;
};

export type ToolProperty = {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ToolFunctionSchema = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
  strict?: boolean;
};

export type ToolDefinition = {
  type: "function";
  function: ToolFunctionSchema;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  context_length?: number;
  num_predict?: number;
  stream?: boolean;
};

export type ChatChunk = {
  delta?: {
    content?: string;
    tool_calls?: Partial<FunctionToolCall>[];
  };
  finishReason?: string | null;
};

export type ModelInfo = {
  id: string;
  name: string;
  size?: number;
  modified_at?: string;
};

export interface LLMProvider {
  name: string;
  health(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<{ message: ChatMessage; finishReason: string }>;
  chatStream(
    req: ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage>;
}
