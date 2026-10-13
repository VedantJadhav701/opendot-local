// Shared by server and client code. No server-only imports here.
//
// OpenDot-local only runs ORIGINAL, unmodified models from the official Ollama library.
// Fine-tuned, merged or custom-built models (anything made with `ollama create`, `hf.co/...`
// or a `user/model` name) are hidden and never selected automatically.
//
// NOTE: "qwen3:4b-instruct-2507" (without a quant suffix) is NOT an official Ollama tag.
// The official tag is "qwen3:4b-instruct-2507-q4_K_M". A model that exists locally under the
// short name was built by hand, so it is treated as custom and not listed.

export const DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M";

export type CatalogModel = {
  id: string; // exact tag in the Ollama library
  label: string;
  params: string;
  sizeGB: number; // download size
  // Fit numbers assume a 16k context window (the app default), so weights + about 3 GB of KV cache
  // have to fit for the whole model to stay on the GPU. They are estimates: check `ollama ps`.
  minVramGB: number;
  minRamGB: number; // enough system RAM to run it on CPU / split CPU+GPU
  note: string;
  recommendable: boolean; // may be picked as "Recommended for your computer"
};

// Ordered by quality / hardware need, smallest first. Every tag was checked against ollama.com/library.
export const MODEL_CATALOG: readonly CatalogModel[] = [
  { id: DEFAULT_MODEL, label: "Qwen3 4B Instruct", params: "4B", sizeGB: 2.5, minVramGB: 6, minRamGB: 8, note: "Best starting point. Fast, reliable tool calling.", recommendable: true },
  { id: "qwen3:4b-instruct-2507-q8_0", label: "Qwen3 4B Instruct (higher quality)", params: "4B", sizeGB: 4.3, minVramGB: 8, minRamGB: 12, note: "Same model, less compression. Slightly better answers.", recommendable: false },
  { id: "qwen3:8b", label: "Qwen3 8B", params: "8B", sizeGB: 5.2, minVramGB: 8, minRamGB: 16, note: "Stronger reasoning and longer tasks.", recommendable: true },
  { id: "llama3.1:8b", label: "Llama 3.1 8B Instruct", params: "8B", sizeGB: 4.9, minVramGB: 8, minRamGB: 16, note: "Different model family from Meta.", recommendable: false },
  { id: "qwen3:14b", label: "Qwen3 14B", params: "14B", sizeGB: 9.3, minVramGB: 14, minRamGB: 24, note: "Noticeably better on hard tasks.", recommendable: true },
  { id: "qwen3:30b-a3b-instruct-2507-q4_K_M", label: "Qwen3 30B-A3B Instruct", params: "30B (3B active)", sizeGB: 19, minVramGB: 22, minRamGB: 32, note: "Large model that runs fast for its size.", recommendable: true },
  { id: "qwen3:32b", label: "Qwen3 32B", params: "32B", sizeGB: 20, minVramGB: 28, minRamGB: 48, note: "Highest quality here. Needs a big GPU.", recommendable: true },
];

// Other official tags that are fine to use if already installed, but are not offered for download.
const OFFICIAL_EXTRA = [
  "qwen3:4b",
  "qwen3:4b-instruct",
  "qwen3:4b-q4_K_M",
  "qwen3:4b-q8_0",
  "qwen3:4b-instruct-2507-fp16",
  "qwen3:8b-q4_K_M",
  "qwen3:8b-q8_0",
  "qwen3:14b-q4_K_M",
  "qwen3:14b-q8_0",
  "qwen3:30b",
  "qwen3:30b-instruct",
  "qwen3:30b-a3b",
  "qwen3:30b-a3b-q4_K_M",
  "qwen3:32b-q4_K_M",
  "llama3.1:latest",
  "qwen3.8:27b",
  "qwen2.5-coder:14b",
  "qwen2.5-coder:7b",
  "qwen2.5-coder:32b",
  "gemma4:26b",
  "gemma3:12b",
  "gemma2:9b",
  "gemma2:27b",
  "deepseek-r1:14b",
  "deepseek-r1:8b",
  "deepseek-r1:32b",
];

const OFFICIAL = new Set([...MODEL_CATALOG.map((m) => m.id), ...OFFICIAL_EXTRA].map((id) => id.toLowerCase()));

function allowAnyModel(): boolean {
  return typeof process !== "undefined" && process.env?.DOTS_ALLOW_ANY_MODEL === "1";
}

/** True for an original model from the official Ollama library list above. */
export function isOfficialModel(id: string): boolean {
  if (!id) return false;
  const lower = id.trim().toLowerCase();
  // Do not allow embedding models for chat
  if (lower.includes("embed") || lower.includes("bge") || lower.includes("minilm")) return false;
  // If it's an explicit official model or doesn't have custom namespaces like hf.co or user/
  if (OFFICIAL.has(lower)) return true;
  if (allowAnyModel() && !lower.includes("/") && !lower.startsWith("hf.co")) return true;
  return false;
}

export function catalogEntry(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id.toLowerCase() === id.trim().toLowerCase());
}

// ---------- hardware fit ----------

export type Fit = "great" | "slow" | "too-large";
export type HardwareLike = { ramGB: number; vramGB: number | null; unifiedMemory?: boolean };

function gpuBudgetGB(hw: HardwareLike): number | null {
  // Apple Silicon: the GPU shares system memory and can use roughly two thirds of it.
  if (hw.unifiedMemory) return Math.round(hw.ramGB * 0.65 * 10) / 10;
  return hw.vramGB;
}

/** great = whole model on the GPU, slow = runs but spills to CPU/RAM, too-large = would not run well. */
export function fitFor(model: CatalogModel, hw: HardwareLike): Fit {
  const gpu = gpuBudgetGB(hw);
  if (gpu !== null && gpu + 0.25 >= model.minVramGB) return "great";
  if (hw.ramGB >= model.minRamGB) return "slow";
  return "too-large";
}

/** The best recommendable model that fully fits; otherwise the smallest one. */
export function recommendedModel(hw: HardwareLike): string {
  const candidates = MODEL_CATALOG.filter((m) => m.recommendable);
  let best = candidates[0];
  for (const m of candidates) if (fitFor(m, hw) === "great") best = m;
  return best.id;
}
