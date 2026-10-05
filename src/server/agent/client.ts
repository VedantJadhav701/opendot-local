import "server-only";
import { activeModel, activeReviewModel, getResolvedSync, isOllamaConnected, resolveModels, setDefaultModel } from "../llm";
import { getSetting } from "../db";

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
  const r = getResolvedSync();
  const defaultSaved = getSetting("default_model");
  return {
    ...r,
    defaultModel: defaultSaved || r.main,
  };
}

export function isReasoningModel(_model: string): boolean {
  return false;
}

export function supportsComputerTool(_model: string): boolean {
  return true;
}

export { setDefaultModel };
