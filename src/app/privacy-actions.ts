"use server";

import { db, getSetting, setSetting } from "@/server/db";
import { assertAllowed, isLocalHost, offlineMode } from "@/server/net/netlog";

export type PrivacySummary = {
  internetRequests: number;
  uniqueHosts: number;
  cloudBoostActive: boolean;
  cloudBoostHost: string | null;
  composioConnected: boolean;
  offline: boolean;
  searchEndpoint: string;
};

export type PrivacyLogEntry = {
  id: number;
  ts: number;
  scope: "internet" | "local";
  host: string;
  path: string | null;
  method: string | null;
  reason: string | null;
  status: number | null;
  note: string | null;
};

export async function getPrivacySummary(hours = 24): Promise<PrivacySummary> {
  const since = Date.now() - hours * 3600_000;
  const rows = db()
    .prepare("SELECT host, reason FROM net_log WHERE ts >= ? AND scope = 'internet'")
    .all(since) as { host: string; reason: string | null }[];

  const hosts = new Set<string>();
  let cloudBoostActive = false;
  let cloudBoostHost: string | null = null;

  for (const r of rows) {
    hosts.add(r.host);
    if (r.reason === "cloud_model") {
      cloudBoostActive = true;
      cloudBoostHost = r.host;
    }
  }

  const { signedIn } = await import("@/server/composio");

  return {
    internetRequests: rows.length,
    uniqueHosts: hosts.size,
    cloudBoostActive,
    cloudBoostHost,
    composioConnected: signedIn(),
    offline: offlineMode(),
    searchEndpoint: getSetting("search_endpoint") || "https://html.duckduckgo.com/html",
  };
}

export async function getPrivacyLog(limit = 100, filter?: { scope?: "internet" | "local"; host?: string }): Promise<PrivacyLogEntry[]> {
  let query = "SELECT id, ts, scope, host, path, method, reason, status, note FROM net_log WHERE 1=1";
  const params: (string | number)[] = [];

  if (filter?.scope) {
    query += " AND scope = ?";
    params.push(filter.scope);
  }
  if (filter?.host) {
    query += " AND host LIKE ?";
    params.push(`%${filter.host}%`);
  }

  query += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);

  const rows = db().prepare(query).all(...params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    scope: (r.scope as "internet" | "local") || "local",
    host: String(r.host || ""),
    path: r.path !== null && r.path !== undefined ? String(r.path) : null,
    method: r.method !== null && r.method !== undefined ? String(r.method) : null,
    reason: r.reason !== null && r.reason !== undefined ? String(r.reason) : null,
    status: r.status !== null && r.status !== undefined ? Number(r.status) : null,
    note: r.note !== null && r.note !== undefined ? String(r.note) : null,
  }));
}

export async function clearPrivacyLog(): Promise<void> {
  db().exec("DELETE FROM net_log");
}

export async function setOfflineMode(on: boolean): Promise<void> {
  setSetting("offline_mode", on ? "1" : "0");
}

export async function setSearchEndpoint(url: string): Promise<void> {
  setSetting("search_endpoint", url.trim() || null);
}

export async function exportPrivacyCsv(): Promise<string> {
  const rows = db()
    .prepare("SELECT ts, scope, host, path, method, reason, status, note FROM net_log ORDER BY ts DESC LIMIT 5000")
    .all() as Record<string, unknown>[];

  const header = "timestamp,scope,host,path,method,reason,status,note\n";
  const body = rows
    .map((r) =>
      [
        new Date(Number(r.ts)).toISOString(),
        r.scope,
        r.host,
        `"${String(r.path || "").replace(/"/g, '""')}"`,
        r.method,
        r.reason,
        r.status,
        `"${String(r.note || "").replace(/"/g, '""')}"`,
      ].join(",")
    )
    .join("\n");

  return header + body;
}
