import type { ModelInfo } from "../llm/types";

export const DEFAULT_MODEL = "qwen3:4b-instruct-2507";
export const FAST_MODEL = "qwen3:1.7b";
export const FAST_MODEL_ALIASES = ["vidya-1.7b:latest", "llama3.2:1b", "gemma2:2b", "qwen2.5:3b"] as const;
export const QUALITY_MODELS = ["qwen3:8b", "qwen3:14b", "qwen3:32b"] as const;

export type CapabilityProfile = {
  os: NodeJS.Platform;
  cpu: string;
  ramGB: number;
  gpu: string | null;
  vramGB: number | null;
  ollama: boolean;
  docker: boolean;
  diskFreeGB: number | null;
};

export type ModelTier = "fast" | "default" | "quality";
export type TaskComplexity = "easy" | "normal" | "hard";

export type ModelDecision = {
  complexity: TaskComplexity;
  score: number;
  preferred: string;
  selected: string;
  installed: boolean;
  usedAlias?: boolean;
  reason: string;
};

export type ModelManagerState = {
  connected: boolean;
  profile: CapabilityProfile;
  installed: ModelInfo[];
  defaultModel: string;
  defaultInstalled: boolean;
  browser: {
    ok: boolean;
    channel: string;
    executablePath?: string;
    error?: string;
  };
};
