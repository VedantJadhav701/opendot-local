"use server";

import type { ModelManagerState, PullStatus } from "@/server/models/types";

/** Full first-run / settings state: hardware, catalog with fit, installed models, active downloads. */
export async function getModelSetup(): Promise<ModelManagerState> {
  const { modelManagerState } = await import("@/server/models/manager");
  return modelManagerState();
}

/** Start downloading an original Ollama model in the background. Returns an error message or null. */
export async function startModelPull(model: string): Promise<string | null> {
  try {
    const { startPull } = await import("@/server/models/downloader");
    startPull(String(model));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function getPullProgress(): Promise<PullStatus[]> {
  const { pullStatuses } = await import("@/server/models/downloader");
  return pullStatuses();
}

/** Light call for the model dropdown: the models the app may use right now. */
export async function getModelOptions(): Promise<{ models: string[]; defaultModel: string; connected: boolean; needsSetup: boolean }> {
  const { resolveModels, isOllamaConnected } = await import("@/server/llm");
  const { isOfficialModel } = await import("@/lib/model-catalog");
  const [resolved, connected] = await Promise.all([resolveModels(), isOllamaConnected().catch(() => false)]);
  const local = resolved.available.filter((m) => isOfficialModel(m));
  return { models: resolved.available, defaultModel: resolved.main, connected, needsSetup: connected && local.length === 0 };
}

export async function getTuning(): Promise<{ tuning: import("@/server/models/tuning").Tuning; perfMode: string }> {
  const { detectCapabilities } = await import("@/server/models/detector");
  const { resolveTuning } = await import("@/server/models/tuning");
  const { getSetting } = await import("@/server/db");
  const { activeModel } = await import("@/server/llm");
  const profile = await detectCapabilities();
  const perfMode = (getSetting("perf_mode") as any) ?? "auto";
  const model = await activeModel();
  const tuning = resolveTuning(profile, model, perfMode);
  return { tuning, perfMode };
}

export async function setPerfMode(mode: string): Promise<void> {
  const { setSetting } = await import("@/server/db");
  setSetting("perf_mode", mode);
}
