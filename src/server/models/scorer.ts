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
  const fastCandidates = [FAST_MODEL, ...FAST_MODEL_ALIASES];
  const fast = fastCandidates.find(has);
  const quality = QUALITY_MODELS.find((id) => has(id) && profile.ramGB >= 12) ?? QUALITY_MODELS.find((id) => has(id));
  const preferred = complexity === "easy" ? FAST_MODEL : complexity === "hard" ? quality ?? QUALITY_MODELS[0] : DEFAULT_MODEL;
  const selected = complexity === "easy" && fast ? fast : has(preferred) ? preferred : has(DEFAULT_MODEL) ? DEFAULT_MODEL : installed[0] ?? DEFAULT_MODEL;
  const usedAlias = complexity === "easy" && Boolean(fast) && fast !== FAST_MODEL;
  return {
    complexity,
    score,
    preferred,
    selected,
    installed: has(preferred) || (complexity === "easy" && Boolean(fast)),
    usedAlias,
    reason: complexity === "easy" ? "Fast tasks use qwen3:1.7b when installed, or a small installed alias otherwise." : complexity === "hard" ? "Hard tasks prefer an installed Qwen3 8B+ model." : "Normal tasks stay on the product default.",
  };
}
