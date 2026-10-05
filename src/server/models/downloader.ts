import "server-only";
import { OllamaProvider } from "../llm/ollama";
import { DEFAULT_MODEL } from "./types";

export async function downloadModel(model = DEFAULT_MODEL, onProgress?: (completed: number, total: number) => void): Promise<void> {
  const provider = new OllamaProvider();
  if (!(await provider.health())) throw new Error("Ollama is not running. Install Ollama, then try again.");
  await provider.pullModel(model, onProgress);
}
