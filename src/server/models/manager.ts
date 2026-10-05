import "server-only";
import { OllamaProvider } from "../llm/ollama";
import { checkSystemHealth } from "../health";
import { detectCapabilities } from "./detector";
import { DEFAULT_MODEL, type ModelManagerState } from "./types";

export async function modelManagerState(): Promise<ModelManagerState> {
  const provider = new OllamaProvider();
  const connected = await provider.health();
  const [profile, installed, health] = await Promise.all([detectCapabilities(), connected ? provider.listModels() : Promise.resolve([]), checkSystemHealth()]);
  return {
    connected,
    profile,
    installed,
    defaultModel: DEFAULT_MODEL,
    defaultInstalled: installed.some((model) => model.id === DEFAULT_MODEL),
    browser: health.browser,
  };
}
