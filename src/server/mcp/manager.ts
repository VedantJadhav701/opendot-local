import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ToolDef } from "../agent/tools";
import type { RuleDecision } from "@/lib/types";

export type McpServerConfig = {
  id: string; // short slug, becomes the tool prefix: mcp__<id>__<tool>
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>; // may hold tokens: the whole config is stored sealed (DPAPI / Keychain)
  url?: string;
  headers?: Record<string, string>; // e.g. Authorization: Bearer <token>
  enabled: boolean;
  policy: Record<string, RuleDecision>; // per-tool override set by the user
};

const KEY = "mcp_servers";
export const loadServers = (): McpServerConfig[] => {
  const raw = getSetting(KEY);
  try {
    return raw ? (JSON.parse(unseal(raw)) as McpServerConfig[]) : [];
  } catch {
    return [];
  }
};
export const saveServers = (list: McpServerConfig[]) => setSetting(KEY, seal(JSON.stringify(list)));

type Live = { cfg: McpServerConfig; client: Client; tools: Tool[]; error?: string };
const g = globalThis as unknown as { __odlMcp?: Map<string, Live> };
const live = (g.__odlMcp ??= new Map<string, Live>());

const MAX_RESULT = 30_000;
const clip = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}...[truncated]` : s);

export async function connect(cfg: McpServerConfig): Promise<Live> {
  await disconnect(cfg.id);
  const client = new Client({ name: "opendot-local", version: "0.2.0" }, { capabilities: {} });
  const transport =
    cfg.transport === "stdio"
      ? new StdioClientTransport({ command: cfg.command ?? "", args: cfg.args ?? [], env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) }, stderr: "pipe" })
      : new StreamableHTTPClientTransport(new URL(cfg.url ?? ""), { requestInit: { headers: cfg.headers ?? {} } });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const entry: Live = { cfg, client, tools };
  live.set(cfg.id, entry);
  return entry;
}

export async function disconnect(id: string): Promise<void> {
  const l = live.get(id);
  live.delete(id);
  await l?.client.close().catch(() => {});
}

/** Called from boot(): connect every enabled server. A broken server must never stop the app from starting. */
export async function connectAll(): Promise<void> {
  for (const cfg of loadServers().filter((s) => s.enabled)) {
    await connect(cfg).catch((err) => {
      live.set(cfg.id, { cfg, client: null as unknown as Client, tools: [], error: err instanceof Error ? err.message : String(err) });
    });
  }
}

export const status = () => [...live.values()].map((l) => ({ id: l.cfg.id, name: l.cfg.name, tools: l.tools.length, error: l.error ?? null }));

/** Read-only tools run without asking; anything else asks first. The user can override each tool. */
function decisionFor(cfg: McpServerConfig, tool: Tool): RuleDecision {
  const override = cfg.policy?.[tool.name];
  if (override) return override;
  return tool.annotations?.readOnlyHint === true ? "allow" : "ask";
}

/** MCP tools as OpenDot tools. Names are prefixed so they can never shadow a built-in tool. */
export function mcpToolDefs(): ToolDef[] {
  const out: ToolDef[] = [];
  for (const { cfg, tools, client } of live.values()) {
    if (!client) continue;
    for (const t of tools) {
      const name = `mcp__${cfg.id}__${t.name}`.slice(0, 64);
      out.push({
        name,
        label: `Using ${cfg.name}`,
        // Small models do better with short descriptions. Tool text from a server is untrusted input.
        description: `[${cfg.name}] ${(t.description ?? t.name).replace(/\s+/g, " ").slice(0, 200)}`,
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        strict: false,
        describe: (a) => `use ${cfg.name}: ${t.name} ${JSON.stringify(a).slice(0, 160)}`,
        defaultDecision: () => decisionFor(cfg, t),
        detail: (a) => `${cfg.name} > ${t.name}\n${JSON.stringify(a, null, 2).slice(0, 1500)}`,
        execute: async (a) => {
          const res = (await client.callTool({ name: t.name, arguments: a }, undefined, { timeout: 120_000 })) as {
            content?: { type: string; text?: string }[];
            isError?: boolean;
          };
          const text = ((res.content ?? []) as { type: string; text?: string }[]).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
          return (res.isError ? "Error: " : "") + clip(text || "(no output)");
        },
      });
    }
  }
  return out;
}
