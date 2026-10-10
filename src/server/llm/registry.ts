import "server-only";
import { OllamaProvider } from "./ollama";
import type { LLMProvider, ModelInfo } from "./types";
import { getSetting, setSetting } from "../db";
import { DEFAULT_MODEL } from "../models/types";

const DEFAULT_MAIN_MODELS = [DEFAULT_MODEL];
const DEFAULT_REVIEW_MODELS = [DEFAULT_MODEL];

let activeProvider: LLMProvider = new OllamaProvider();

export function getProvider(model?: string): LLMProvider {
  const { hasCloudBoostKey, getCloudBoostKey } = require("../vault");
  let cloudModel = getSetting("cloud_boost_model") || "moonshotai/kimi-k3";
  if (cloudModel.includes("llama-3.1-70b")) {
    cloudModel = "moonshotai/kimi-k3";
  }
  const cloudUrl = getSetting("cloud_boost_url") || "https://api.openai.com/v1";

  const isCloudTarget =
    model &&
    (model === cloudModel ||
      model.includes("moonshotai") ||
      model.includes("kimi") ||
      model.includes("muse-glimmer") ||
      model.includes("meta/") ||
      model.includes("cloud"));

  if (hasCloudBoostKey() && isCloudTarget) {
    const { OpenAICompatProvider } = require("./openai-compat");
    return new OpenAICompatProvider({
      baseUrl: cloudUrl,
      apiKey: getCloudBoostKey() || undefined,
      model: model || cloudModel,
    });
  }

  return activeProvider;
}

export function setProvider(provider: LLMProvider) {
  activeProvider = provider;
}

export async function isOllamaConnected(): Promise<boolean> {
  return activeProvider.health();
}

export async function listAvailableModels(): Promise<ModelInfo[]> {
  const isHealthy = await isOllamaConnected();
  const models = isHealthy ? await activeProvider.listModels() : [];

  const { hasCloudBoostKey } = require("../vault");
  if (hasCloudBoostKey()) {
    const cloudModel = getSetting("cloud_boost_model") || "moonshotai/kimi-k3";
    const cloudModels = [cloudModel, "meta/muse-glimmer-30b"];
    for (const cm of cloudModels) {
      if (!models.some((m) => m.id === cm)) {
        models.push({ id: cm, name: `${cm} (Cloud)` });
      }
    }
  }

  return models;
}

export function pickBestAvailableModel(available: string[], preferredTarget?: string): string {
  if (!available || available.length === 0) {
    return preferredTarget || DEFAULT_MODEL;
  }

  const genModels = available.filter((m) => !m.toLowerCase().includes("embed"));
  const pool = genModels.length > 0 ? genModels : available;

  if (preferredTarget && pool.includes(preferredTarget)) {
    return preferredTarget;
  }

  const defaultSaved = getSetting("default_model");
  if (defaultSaved && pool.includes(defaultSaved)) {
    return defaultSaved;
  }

  const preferredPatterns = [
    /qwen3:4b/i,
    /qwen3/i,
    /4b/i,
    /7b/i,
    /8b/i,
    /14b/i,
    /27b/i,
    /32b/i,
    /70b/i,
    /qwen2\.5/i,
    /gemma/i,
    /llama/i,
    /vero/i,
  ];

  for (const pattern of preferredPatterns) {
    const found = pool.find((m) => pattern.test(m));
    if (found) return found;
  }

  const nonTiny = pool.find((m) => !/1b|1\.5b|1\.7b|2b|nano|micro|tiny/i.test(m));
  if (nonTiny) return nonTiny;

  return pool[0];
}

let lastResolved: { main: string; review: string; available: string[] } = {
  main: DEFAULT_MODEL,
  review: DEFAULT_MODEL,
  available: [],
};

export function getResolvedSync(): { main: string; review: string; available: string[] } {
  const { hasCloudBoostKey } = require("../vault");
  const cloudModel = getSetting("cloud_boost_model") || "moonshotai/kimi-k3";
  const available = [...lastResolved.available];
  const cloudModels = [cloudModel, "meta/muse-glimmer-30b"];
  if (hasCloudBoostKey()) {
    for (const cm of cloudModels) {
      if (!available.includes(cm)) {
        available.push(cm);
      }
    }
  }
  return { ...lastResolved, available };
}

export async function resolveModels(): Promise<{ main: string; review: string; available: string[] }> {
  const models = await listAvailableModels();
  const modelIds = models.filter((m) => !m.id.toLowerCase().includes("embed")).map((m) => m.id);

  const envMain = process.env.DOTS_MODEL;
  const envReview = process.env.DOTS_REVIEW_MODEL;

  const main =
    envMain ||
    getSetting("default_model") ||
    pickBestAvailableModel(modelIds, DEFAULT_MODEL);

  const review =
    envReview ||
    getSetting("review_model") ||
    main;

  lastResolved = { main, review, available: modelIds };

  return lastResolved;
}

export async function activeModel(override?: string | null): Promise<string> {
  const res = await resolveModels();
  const available = res.available;
  const target = override || getSetting("default_model") || DEFAULT_MODEL;

  return pickBestAvailableModel(available, target);
}

export async function activeReviewModel(): Promise<string> {
  const res = await resolveModels();
  const available = res.available;
  const target = getSetting("review_model") || DEFAULT_MODEL;

  return pickBestAvailableModel(available, target);
}

export function setDefaultModel(modelId: string) {
  setSetting("default_model", modelId);
}

export function setReviewModel(modelId: string) {
  setSetting("review_model", modelId);
}
