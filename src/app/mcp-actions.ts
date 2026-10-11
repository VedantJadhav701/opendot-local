"use server";

import {
  loadServers,
  saveServers,
  connect,
  disconnect,
  status,
  type McpServerConfig,
} from "@/server/mcp/manager";
import type { RuleDecision } from "@/lib/types";

export type ConnectorInfo = {
  config: McpServerConfig;
  toolsCount: number;
  toolNames: string[];
  error: string | null;
};

export async function listConnectors(): Promise<ConnectorInfo[]> {
  try {
    const configs = loadServers();
    const liveStatus = status();
    const statusMap = new Map(liveStatus.map((s) => [s.id, s]));

    return configs.map((c) => {
      const s = statusMap.get(c.id);
      return {
        config: c,
        toolsCount: s ? s.tools : 0,
        toolNames: [],
        error: s ? s.error : null,
      };
    });
  } catch (err) {
    console.error("[dots] listConnectors error:", err);
    return [];
  }
}

export async function saveConnector(
  cfg: McpServerConfig
): Promise<{ ok: boolean; error?: string }> {
  try {
    const list = loadServers();
    const index = list.findIndex((s) => s.id === cfg.id);
    if (index >= 0) {
      list[index] = cfg;
    } else {
      list.push(cfg);
    }
    saveServers(list);

    if (cfg.enabled) {
      await connect(cfg);
    } else {
      await disconnect(cfg.id);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeConnector(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const list = loadServers().filter((s) => s.id !== id);
    saveServers(list);
    await disconnect(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testConnector(
  cfg: McpServerConfig
): Promise<{ ok: boolean; toolNames?: string[]; error?: string }> {
  try {
    const live = await connect(cfg);
    const toolNames = live.tools.map((t) => t.name);
    return { ok: true, toolNames };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setToolPolicy(
  serverId: string,
  toolName: string,
  decision: RuleDecision
): Promise<{ ok: boolean; error?: string }> {
  try {
    const list = loadServers();
    const s = list.find((c) => c.id === serverId);
    if (!s) return { ok: false, error: "Server not found" };
    s.policy = { ...s.policy, [toolName]: decision };
    saveServers(list);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
