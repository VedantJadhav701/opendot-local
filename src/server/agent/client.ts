import "server-only";
import { activeModel, activeReviewModel, getResolvedSync, isOllamaConnected, resolveModels, setDefaultModel } from "../llm";
import { getSetting } from "../db";
import { getCloudBoostKey, hasCloudBoostKey, saveCloudBoostKey } from "../vault";

let cachedHasKey = true;
let cachedKeySource: "env" | "settings" | "ollama" | null = "ollama";

export async function refreshClientState(): Promise<void> {
  const ollamaOk = await isOllamaConnected().catch(() => false);
  const cloudKey = hasCloudBoostKey();
  cachedHasKey = ollamaOk || cloudKey;
  cachedKeySource = cloudKey ? "settings" : ollamaOk ? "ollama" : null;
}

export function hasKey(): boolean {
  void refreshClientState();
  return cachedHasKey;
}

export function keySource(): "env" | "settings" | "ollama" | null {
  void refreshClientState();
  return cachedKeySource;
}

export async function saveApiKey(key: string): Promise<string | null> {
  if (!key.trim()) return null;
  saveCloudBoostKey(key.trim());
  await refreshClientState();
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
