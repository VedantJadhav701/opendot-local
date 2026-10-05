import "server-only";

export type ProviderMode = "local" | "cloud" | "auto";

const dotProviderModes = new Map<string, ProviderMode>();
const dotLocalFailures = new Map<string, number>();

export function setDotProviderMode(dotId: string, mode: ProviderMode): void {
  dotProviderModes.set(dotId, mode);
}

export function getDotProviderMode(dotId: string): ProviderMode {
  return dotProviderModes.get(dotId) ?? "local";
}

export function recordLocalFailure(dotId: string): number {
  const current = dotLocalFailures.get(dotId) ?? 0;
  const next = current + 1;
  dotLocalFailures.set(dotId, next);
  console.log(`[provider-routing] Dot ${dotId} recorded local failure count: ${next}`);
  return next;
}

export function resetLocalFailures(dotId: string): void {
  dotLocalFailures.delete(dotId);
}

export function resolveProviderRouting(
  dotId: string,
  options: { userExplicitClick?: boolean } = {}
): { useCloud: boolean; reason: string; mode: ProviderMode } {
  const mode = getDotProviderMode(dotId);

  if (mode === "cloud") {
    console.log(`[provider-routing] Dot ${dotId} routing -> CLOUD (mode explicit: cloud)`);
    return { useCloud: true, reason: "Explicit per-dot setting: cloud", mode };
  }

  if (mode === "local") {
    console.log(`[provider-routing] Dot ${dotId} routing -> LOCAL (mode explicit: local)`);
    return { useCloud: false, reason: "Explicit per-dot setting: local", mode };
  }

  // mode === "auto"
  if (options.userExplicitClick) {
    console.log(`[provider-routing] Dot ${dotId} routing -> CLOUD (auto: explicit user click)`);
    return { useCloud: true, reason: "Auto escalation: explicit user click", mode };
  }

  const failures = dotLocalFailures.get(dotId) ?? 0;
  if (failures >= 2) {
    console.log(`[provider-routing] Dot ${dotId} routing -> CLOUD (auto: ${failures} verifier failures)`);
    return { useCloud: true, reason: `Auto escalation: ${failures} local verifier failures`, mode };
  }

  console.log(`[provider-routing] Dot ${dotId} routing -> LOCAL (auto: local-first, failures=${failures})`);
  return { useCloud: false, reason: "Auto: local-first default", mode };
}
