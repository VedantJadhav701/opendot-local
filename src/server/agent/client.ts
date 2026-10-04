import "server-only";
import { activeModel, activeReviewModel, isOllamaConnected, resolveModels, setDefaultModel } from "../llm";

export function hasKey(): boolean {
  return true; // Local-first Ollama default
}

export function keySource(): "env" | "settings" | "ollama" | null {
  return "ollama";
}

export async function saveApiKey(_key: string): Promise<string | null> {
  return null;
}

export function resetModels() {
  // Provider dynamic check automatically re-resolves models
}

export function canThink(): boolean {
  return true;
}

export async function models(): Promise<{ main: string; review: string; available: string[] }> {
  return resolveModels();
}

export async function modelFor(dotModel: string | null): Promise<string> {
  return activeModel(dotModel);
}

export async function reviewModelFor(): Promise<string> {
  return activeReviewModel();
}

export function knownModels(): { main: string; review: string; available: string[]; defaultModel: string } {
  return {
    main: "qwen3:4b",
    review: "qwen3:0.6b",
    available: ["qwen3:4b", "qwen3:0.6b", "qwen3:1.7b", "llama3.2:3b"],
    defaultModel: "qwen3:4b",
  };
}

export function isReasoningModel(_model: string): boolean {
  return false;
}

export function supportsComputerTool(_model: string): boolean {
  return true;
}

export { setDefaultModel };
