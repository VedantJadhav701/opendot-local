import "server-only";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";

export const OPENROUTER_PREFIX = "openrouter:";
const KEY_SETTING = "openrouter_key";

function envKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

export function openRouterKey(): string | null {
  if (envKey()) return envKey();
  const sealed = getSetting(KEY_SETTING);
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    return null;
  }
}

export const openRouterSource = (): "env" | "settings" | null => (envKey() ? "env" : getSetting(KEY_SETTING) ? "settings" : null);

export const isOpenRouterModel = (model: string) => model.startsWith(OPENROUTER_PREFIX);
export const openRouterId = (model: string) => model.slice(OPENROUTER_PREFIX.length);

export async function saveOpenRouterKey(key: string): Promise<string | null> {
  if (envKey()) return "The OpenRouter key is set by OPENROUTER_API_KEY.";
  if (!key) {
    setSetting(KEY_SETTING, null);
    return null;
  }
  setSetting(KEY_SETTING, seal(key));
  return null;
}

export async function openModels(): Promise<string[]> {
  return [];
}

export const preferredOpenModel = (ids: string[]) => ids[0] || "qwen3:4b";
export const smallOpenModel = (ids: string[]) => ids[0] || "qwen3:0.6b";
