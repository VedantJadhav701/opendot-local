import "server-only";
import { DEFAULT_MODEL, FAST_MODEL, FAST_MODEL_ALIASES, QUALITY_MODELS, type ModelTier } from "./types";

export type RegisteredModel = { id: string; tier: ModelTier; label: string; approxSizeGB: number; minRamGB: number };

export const MODEL_REGISTRY: RegisteredModel[] = [
  { id: FAST_MODEL, tier: "fast", label: "Fast", approxSizeGB: 1.1, minRamGB: 4 },
  ...FAST_MODEL_ALIASES.map((id) => ({ id, tier: "fast" as const, label: "Fast installed alias", approxSizeGB: 1.5, minRamGB: 4 })),
  { id: DEFAULT_MODEL, tier: "default", label: "Balanced default", approxSizeGB: 2.5, minRamGB: 8 },
  ...QUALITY_MODELS.map((id, index) => ({ id, tier: "quality" as const, label: "Quality", approxSizeGB: [5, 9, 20][index], minRamGB: [12, 20, 40][index] })),
];

export function modelInfo(id: string): RegisteredModel {
  return MODEL_REGISTRY.find((model) => model.id === id) ?? { id, tier: "quality", label: "Installed", approxSizeGB: 0, minRamGB: 0 };
}
