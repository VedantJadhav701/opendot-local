import "server-only";
import { OllamaProvider } from "../llm/ollama";
import { DEFAULT_MODEL, isOfficialModel } from "@/lib/model-catalog";
import type { PullStatus } from "./types";

const g = globalThis as unknown as { __dotsPulls?: Map<string, PullStatus> };
const pulls = (g.__dotsPulls ??= new Map<string, PullStatus>());

export function pullStatuses(): PullStatus[] {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, p] of pulls) if (p.finishedAt && p.finishedAt < cutoff) pulls.delete(id);
  return [...pulls.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Only original Ollama-library models can be downloaded from the app. */
export function assertPullable(model: string): void {
  if (!isOfficialModel(model)) {
    throw new Error(`"${model}" is not on the list of original Ollama models, so OpenDot-local will not download it.`);
  }
}

/** Download and wait for it to finish (kept for existing callers). */
export async function downloadModel(model = DEFAULT_MODEL, onProgress?: (completed: number, total: number) => void): Promise<void> {
  assertPullable(model);
  const provider = new OllamaProvider();
  if (!(await provider.health())) throw new Error("Ollama is not running. Install Ollama, then try again.");
  await provider.pullModel(model, onProgress);
}

/** Start a download in the background and return at once. Progress is read with pullStatuses(). */
export function startPull(model: string): PullStatus {
  assertPullable(model);
  const existing = pulls.get(model);
  if (existing?.state === "pulling") return existing;
  const status: PullStatus = { id: model, state: "pulling", completed: 0, total: 0, startedAt: Date.now() };
  pulls.set(model, status);

  import("../net/netlog").then(({ logRequest }) => {
    logRequest("https://registry.ollama.ai/", "GET", undefined, { reason: "model_download", note: `via Ollama (${model})` });
  }).catch(() => {});

  void run(model, status);
  return status;
}

async function run(model: string, status: PullStatus): Promise<void> {
  try {
    await downloadModel(model, (completed, total) => {
      // Ollama reports each layer separately; the weights file is by far the largest, so follow that one.
      if (total >= status.total) {
        status.total = total;
        status.completed = completed;
      }
    });
    status.completed = status.total;
    status.state = "done";
    await afterInstall(model).catch(() => {});
  } catch (err) {
    status.state = "error";
    status.error = err instanceof Error ? err.message : String(err);
  }
  status.finishedAt = Date.now();
}

/** After a successful download: make it the default if the user has no working default yet, then tell the UI. */
async function afterInstall(model: string): Promise<void> {
  const { getSetting, setSetting } = await import("../db");
  const { resolveModels } = await import("../llm");
  const { emit } = await import("../bus");
  const { computerInfo } = await import("../snapshot");
  const installed = (await new OllamaProvider().listModels()).map((m) => m.id);
  const saved = getSetting("default_model");
  if (!saved || !isOfficialModel(saved) || !installed.includes(saved)) setSetting("default_model", model);
  await resolveModels();
  emit({ type: "computer", data: computerInfo() });
}
