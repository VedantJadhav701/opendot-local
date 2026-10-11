import "server-only";
import { catalogEntry } from "@/lib/model-catalog";
import type { CapabilityProfile } from "./types";

export type PerfMode = "auto" | "quality" | "balanced" | "fast";
export type Tuning = {
  mode: "quality" | "balanced" | "fast";
  numCtx: number;
  numBatch?: number;
  numPredict: number;
  keepAlive: string;
  reason: string;
};

const CTX = { quality: 16384, balanced: 8192, fast: 4096 } as const;
const OVERHEAD_GB = 0.7; // compute buffers + CUDA context (measured: qwen3 4B at 16k = 5.4 GB total = 2.5 weights + 2.2 KV + ~0.7)

// KV cache in GB per 1,000 tokens at f16: layers * kvHeads * headDim * 2 (K and V) * 2 bytes.
function kvGBPer1k(model: string): number {
  const id = model.toLowerCase();
  if (id.includes("30b-a3b")) return 0.092; // 48 layers, 4 KV heads
  if (id.includes("32b")) return 0.244; // 64 layers, 8 KV heads
  if (id.includes("14b")) return 0.153; // 40 layers, 8 KV heads
  if (id.startsWith("llama3.1")) return 0.122; // 32 layers, 8 KV heads
  return 0.137; // qwen3 4B / 8B: 36 layers, 8 KV heads, head dim 128
}

export function resolveTuning(profile: CapabilityProfile, model: string, mode: PerfMode = "auto"): Tuning {
  const weights = catalogEntry(model)?.sizeGB ?? 4.5;
  const gpu = profile.unifiedMemory ? profile.ramGB * 0.65 : profile.vramGB;
  const kv = kvGBPer1k(model);
  const fits = (ctx: number) => gpu !== null && weights + OVERHEAD_GB + (ctx / 1000) * kv <= gpu + 0.25;

  let chosen: Tuning["mode"];
  let reason: string;
  if (mode !== "auto") {
    chosen = mode;
    reason = "Chosen by you in Settings.";
  } else if (gpu === null) {
    chosen = profile.ramGB >= 24 ? "balanced" : "fast";
    reason = "No supported GPU found, so the model runs on the CPU. A smaller context keeps it responsive.";
  } else if (fits(CTX.quality)) {
    chosen = "quality";
    reason = "The whole model and a 16k context fit on your GPU.";
  } else {
    chosen = "balanced";
    reason = fits(CTX.balanced)
      ? "An 8k context fits on your GPU. Switch to Quality in Settings if you prefer more context and accept slower speed."
      : "An 8k context is the smallest that works reliably for agent tasks. Part of the model runs on the CPU, so it is slower.";
  }

  return {
    mode: chosen,
    numCtx: CTX[chosen],
    numBatch: profile.ramGB < 12 ? 256 : undefined,
    numPredict: 1024,
    keepAlive: "30m",
    reason,
  };
}
