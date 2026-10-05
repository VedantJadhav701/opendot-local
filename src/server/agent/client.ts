import "server-only";
import { activeModel, activeReviewModel, getResolvedSync, isOllamaConnected, resolveModels, setDefaultModel } from "../llm";
import { getSetting } from "../db";
import { getCloudBoostKey, hasCloudBoostKey, saveCloudBoostKey } from "../vault";

export async function hasKey(): Promise<boolean> {
  return (await isOllamaConnected()) || hasCloudBoostKey();
}

export async function keySource(): Promise<"env" | "settings" | "ollama" | null> {
  if (hasCloudBoostKey()) return "settings";
  if (await isOllamaConnected()) return "ollama";
  return null;
}

export async function saveApiKey(key: string): Promise<string | null> {
  if (!key.trim()) return null;
  saveCloudBoostKey(key.trim());
  return "Saved";
}

export function resetModels() {
  // Provider dynamic check automatically re-resolves models
}

export function canThink(model = ""): boolean {
  return isReasoningModel(model);
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

export function isReasoningModel(model: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.includes("r1") || m.includes("reasoner") || m.includes("think") || m.includes("o1") || m.includes("o3") || m.includes("kimi");
}

export function supportsComputerTool(model: string): boolean {
  if (!model) return true;
  return !model.toLowerCase().includes("nano") && !model.toLowerCase().includes("micro");
}

export { setDefaultModel };
