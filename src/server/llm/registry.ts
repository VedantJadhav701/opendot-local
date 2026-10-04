import "server-only";
import { OllamaProvider } from "./ollama";
import type { LLMProvider, ModelInfo } from "./types";
import { getSetting, setSetting } from "../db";

const DEFAULT_MAIN_MODELS = ["qwen3:4b-instruct-2507", "qwen3:4b-instruct-2507-q4_K_M", "qwen3:4b", "qwen2.5:7b", "llama3.2:3b", "llama3.1:8b", "mistral:7b"];
const DEFAULT_REVIEW_MODELS = ["qwen3:0.6b", "qwen3:1.7b", "llama3.2:1b", "qwen2.5:0.5b", "qwen3:4b-instruct-2507"];

let activeProvider: LLMProvider = new OllamaProvider();

export function getProvider(): LLMProvider {
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
  if (!isHealthy) return [];
  return activeProvider.listModels();
}

let lastResolved: { main: string; review: string; available: string[] } = {
  main: "qwen3:4b-instruct-2507",
  review: "qwen3:0.6b",
  available: [],
};

export function getResolvedSync(): { main: string; review: string; available: string[] } {
  return lastResolved;
}

export async function resolveModels(): Promise<{ main: string; review: string; available: string[] }> {
  const models = await listAvailableModels();
  const modelIds = models.map((m) => m.id);

  const envMain = process.env.DOTS_MODEL;
  const envReview = process.env.DOTS_REVIEW_MODEL;

  const main =
    envMain ||
    getSetting("default_model") ||
    DEFAULT_MAIN_MODELS.find((m) => modelIds.includes(m)) ||
    modelIds[0] ||
    "qwen3:4b-instruct-2507";

  const review =
    envReview ||
    getSetting("review_model") ||
    DEFAULT_REVIEW_MODELS.find((m) => modelIds.includes(m)) ||
    modelIds[0] ||
    main;

  lastResolved = { main, review, available: modelIds };

  return lastResolved;
}

export async function activeModel(override?: string | null): Promise<string> {
  const res = await resolveModels();
  const available = res.available;
  const target = override || getSetting("default_model") || "qwen3:4b-instruct-2507";

  if (target && available.length > 0 && !available.includes(target)) {
    console.warn(`[ollama] Model '${target}' not installed locally. Please run \`ollama pull ${target}\`. Falling back to '${available[0]}'.`);
    return available[0];
  }

  return target || res.main;
}

export async function activeReviewModel(): Promise<string> {
  const res = await resolveModels();
  const available = res.available;
  const target = getSetting("review_model");

  if (target && available.length > 0 && !available.includes(target)) {
    return available[0];
  }

  return target || res.review;
}

export function setDefaultModel(modelId: string) {
  setSetting("default_model", modelId);
}

export function setReviewModel(modelId: string) {
  setSetting("review_model", modelId);
}
