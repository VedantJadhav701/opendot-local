import "server-only";
import * as repo from "./repo";
import { emit } from "./bus";
import { canThink, models } from "./agent/client";
import { computerInfo } from "./snapshot";
import { startScheduler } from "./scheduler";
import { startEvents as startTriggerEvents } from "./triggers";
import { refresh as refreshComposio, signedIn } from "./composio";

export function boot() {
  // Nothing is running after a restart; don't leave dots stuck in "working".
  for (const dot of repo.listDots()) {
    if (dot.status === "working") repo.updateDot(dot.id, { status: repo.pendingCards(dot.id).length ? "waiting" : "idle" });
  }
  startScheduler();
  // Listen for Composio trigger events (only if the user added a Composio API key).
  void startTriggerEvents();
  // Learn which models are installed locally & cloud, then broadcast to UI (fills the model pickers).
  const { resolveModels } = require("./llm");
  void resolveModels().then(() => emit({ type: "computer", data: computerInfo() })).catch(() => {});
  // Reconnect to Composio For You with the saved sign-in (fills Settings → Apps and the dots' tools).
  if (signedIn()) void refreshComposio().catch((err) => console.warn("[dots] Composio:", err instanceof Error ? err.message : err));
}
