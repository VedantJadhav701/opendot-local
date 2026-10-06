import "server-only";
import { DEFAULT_MODEL, FAST_MODEL, FAST_MODEL_ALIASES, QUALITY_MODELS, type CapabilityProfile, type ModelDecision, type TaskComplexity } from "./types";

export type TaskSignals = {
  text?: string;
  toolCount?: number;
  coding?: boolean;
  reasoning?: boolean;
  contextSize?: number;
  multiStep?: boolean;
  browserComplexity?: number;
};

export function scoreTask(signals: TaskSignals): number {
  const text = signals.text?.toLowerCase() ?? "";
  let score = Math.min(20, Math.ceil(text.length / 180));
  if (signals.toolCount && signals.toolCount >= 3) score += 20;
  if (signals.coding || /\b(code|coding|repository|backend|react|typescript|debug|test)\b/.test(text)) score += 18;
  if (signals.reasoning || /\b(analy[sz]e|architecture|compare|plan|design|investigate)\b/.test(text)) score += 18;
  if ((signals.contextSize ?? 0) > 12000) score += 12;
  if (signals.multiStep || /\b(full[- ]stack|multi[- ]step|then|and also)\b/.test(text)) score += 12;
  score += Math.min(10, signals.browserComplexity ?? 0);
  return Math.min(100, score);
}

export function classifyTask(signals: TaskSignals): { score: number; complexity: TaskComplexity } {
  const score = scoreTask(signals);
  return { score, complexity: score <= 30 ? "easy" : score <= 70 ? "normal" : "hard" };
}

export function selectModel(signals: TaskSignals, installed: string[], profile: CapabilityProfile): ModelDecision {
  const { score, complexity } = classifyTask(signals);
  const has = (id: string) => installed.includes(id);

  // Always stick to DEFAULT_MODEL (4B) or quality models (8B+). Do not down-route to 1.7B/2B fast models to preserve answer quality.
  const quality = QUALITY_MODELS.find((id) => has(id) && profile.ramGB >= 12) ?? QUALITY_MODELS.find((id) => has(id));
  const preferred = complexity === "hard" && quality ? quality : DEFAULT_MODEL;
  const selected = has(preferred) ? preferred : has(DEFAULT_MODEL) ? DEFAULT_MODEL : installed[0] ?? DEFAULT_MODEL;

  return {
    complexity,
    score,
    preferred,
    selected,
    installed: has(preferred) || has(DEFAULT_MODEL),
    usedAlias: false,
    reason: complexity === "hard" ? "Hard tasks prefer an installed Qwen3 8B+ model." : "Always stay on 4B default model or higher for response quality.",
  };
}
