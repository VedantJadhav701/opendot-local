import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getSetting } from "../db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS net_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  scope     TEXT NOT NULL,          -- 'internet' | 'local'
  host      TEXT NOT NULL,
  path      TEXT,                   -- path only. Query strings and bodies are never stored.
  method    TEXT,
  reason    TEXT,                   -- why: web_search, read_page, cloud_model, model_download ...
  dot_id    TEXT,
  status    INTEGER,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_net_ts ON net_log(ts);
CREATE INDEX IF NOT EXISTS idx_net_host ON net_log(host, ts);
`;

let ready = false;
const ensure = () => {
  if (!ready) {
    db().exec(SCHEMA);
    ready = true;
  }
};

const ctx = new AsyncLocalStorage<{ reason: string; dotId?: string }>();
/** Wrap a tool call so every request made inside it is labelled with why it happened. */
export const withNetReason = <T>(reason: string, dotId: string | undefined, fn: () => Promise<T>): Promise<T> => ctx.run({ reason, dotId }, fn);

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i;
export const isLocalHost = (host: string) => LOCAL_HOST.test(host);

export class OfflineModeError extends Error {
  constructor(host: string) {
    super(`Offline mode is on, so OpenDot-local did not contact ${host}. Turn it off in Settings > Privacy.`);
  }
}
export const offlineMode = () => getSetting("offline_mode") === "1";

export function logRequest(url: string, method = "GET", status?: number, extra?: { reason?: string; note?: string }): void {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return;
    ensure();
    const c = ctx.getStore();
    db()
      .prepare("INSERT INTO net_log (ts, scope, host, path, method, reason, dot_id, status, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(Date.now(), isLocalHost(u.hostname) ? "local" : "internet", u.hostname, u.pathname.slice(0, 200), method, extra?.reason ?? c?.reason ?? null, c?.dotId ?? null, status ?? null, extra?.note ?? null);
  } catch {
    /* logging must never break a request */
  }
}

/** Block non-local requests when offline mode is on. Call before any outbound request. */
export function assertAllowed(url: string): void {
  const host = new URL(url).hostname;
  if (offlineMode() && !isLocalHost(host)) throw new OfflineModeError(host);
}

/** Wrap global fetch once so every fetch in the server process is checked and recorded. */
export function installFetchLogger(): void {
  const g = globalThis as unknown as { __odlFetchPatched?: boolean; fetch: typeof fetch };
  if (g.__odlFetchPatched) return;
  g.__odlFetchPatched = true;
  const original = g.fetch.bind(globalThis);
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    assertAllowed(url);
    try {
      const res = await original(input, init);
      logRequest(url, method, res.status);
      return res;
    } catch (err) {
      logRequest(url, method, 0, { note: err instanceof Error ? err.message.slice(0, 120) : "failed" });
      throw err;
    }
  };
}

export function pruneNetLog(days = 30): void {
  ensure();
  db().prepare("DELETE FROM net_log WHERE ts < ?").run(Date.now() - days * 86_400_000);
}
