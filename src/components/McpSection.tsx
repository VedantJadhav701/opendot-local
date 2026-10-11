"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Plus, RefreshCw, Trash2, Wrench, AlertTriangle, ExternalLink } from "lucide-react";
import { MCP_PRESETS, type McpPreset } from "@/lib/mcp-presets";
import {
  listConnectors,
  saveConnector,
  removeConnector,
  testConnector,
  setToolPolicy,
  type ConnectorInfo,
} from "@/app/mcp-actions";
import type { McpServerConfig } from "@/server/mcp/manager";
import type { RuleDecision } from "@/lib/types";
import { Empty, RemoveButton } from "./SettingsKit";

export default function McpSection() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [testResult, setTestResult] = useState<{ id: string; tools: string[]; error?: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form state
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envStr, setEnvStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const load = () => {
    listConnectors().then(setConnectors).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const handleApplyPreset = (p: McpPreset) => {
    setId(p.id);
    setName(p.name);
    setTransport(p.transport);
    setCommand(p.command || "");
    setArgs(p.args ? p.args.join(" ") : "");
    setUrl(p.url || "");
    setEnvStr(p.defaultEnv ? JSON.stringify(p.defaultEnv, null, 2) : "");
    setShowAddForm(true);
    setFormError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!id.trim() || !name.trim()) {
      setFormError("ID and Name are required.");
      return;
    }

    let parsedEnv: Record<string, string> | undefined;
    if (envStr.trim()) {
      try {
        parsedEnv = JSON.parse(envStr.trim());
      } catch {
        setFormError("Environment variables must be valid JSON format (e.g. {\"TOKEN\": \"xyz\"}).");
        return;
      }
    }

    const cfg: McpServerConfig = {
      id: id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_"),
      name: name.trim(),
      transport,
      command: transport === "stdio" ? command.trim() : undefined,
      args: transport === "stdio" && args.trim() ? args.trim().split(/\s+/) : undefined,
      url: transport === "http" ? url.trim() : undefined,
      env: parsedEnv,
      enabled: true,
      policy: {},
    };

    startTransition(async () => {
      const res = await saveConnector(cfg);
      if (res.ok) {
        setShowAddForm(false);
        setId("");
        setName("");
        setCommand("");
        setArgs("");
        setUrl("");
        setEnvStr("");
        load();
      } else {
        setFormError(res.error || "Failed to save server.");
      }
    });
  };

  const handleTest = (cfg: McpServerConfig) => {
    setTestResult(null);
    startTransition(async () => {
      const res = await testConnector(cfg);
      if (res.ok) {
        setTestResult({ id: cfg.id, tools: res.toolNames || [] });
      } else {
        setTestResult({ id: cfg.id, tools: [], error: res.error });
      }
      load();
    });
  };

  const handleToggleEnable = (cfg: McpServerConfig) => {
    startTransition(async () => {
      await saveConnector({ ...cfg, enabled: !cfg.enabled });
      load();
    });
  };

  const handleRemove = (idToRemove: string) => {
    startTransition(async () => {
      await removeConnector(idToRemove);
      load();
    });
  };

  const handlePolicyChange = (serverId: string, tool: string, decision: RuleDecision) => {
    startTransition(async () => {
      await setToolPolicy(serverId, tool, decision);
      load();
    });
  };

  return (
    <div className="space-y-4">
      {/* Active Connectors */}
      {connectors.length > 0 ? (
        <div className="surface divide-y divide-black/[0.06]">
          {connectors.map((c) => (
            <div key={c.config.id} className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`size-2 rounded-full shrink-0 ${
                    !c.config.enabled
                      ? "bg-foreground/20"
                      : c.error
                      ? "bg-destructive"
                      : "bg-success"
                  }`}
                  title={c.error ? c.error : c.config.enabled ? "Connected" : "Disabled"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{c.config.name}</span>
                    <span className="font-mono text-[10px] uppercase bg-black/[0.05] px-1.5 py-0.5 rounded text-foreground/60">
                      {c.config.transport}
                    </span>
                    <span className="text-body-sm text-foreground/50">
                      ({c.toolsCount} tool{c.toolsCount === 1 ? "" : "s"})
                    </span>
                  </div>
                  {c.error && (
                    <div className="text-caption text-destructive mt-0.5">{c.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-quiet text-[12px] h-7 px-2"
                    disabled={pending}
                    onClick={() => handleTest(c.config)}
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    className="btn-quiet text-[12px] h-7 px-2"
                    disabled={pending}
                    onClick={() => handleToggleEnable(c.config)}
                  >
                    {c.config.enabled ? "Disable" : "Enable"}
                  </button>
                  <RemoveButton label="Remove connector" onClick={() => handleRemove(c.config.id)} />
                </div>
              </div>

              {/* Test feedback */}
              {testResult && testResult.id === c.config.id && (
                <div className="rounded bg-popover p-2.5 text-body-sm border border-black/[0.06]">
                  {testResult.error ? (
                    <span className="text-destructive">Test failed: {testResult.error}</span>
                  ) : (
                    <div>
                      <span className="text-success font-medium">
                        Found {testResult.tools.length} tool(s):
                      </span>{" "}
                      <span className="font-mono text-[11px] text-foreground/75">
                        {testResult.tools.join(", ") || "(none)"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty>No local MCP tools configured yet.</Empty>
      )}

      {/* Preset recommendations */}
      <div className="pt-1">
        <div className="text-body-sm text-foreground/60 mb-2 font-medium">Quick presets</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {MCP_PRESETS.map((p) => (
            <div
              key={p.id}
              className="surface flex items-start justify-between p-3 gap-3 border border-black/[0.06] rounded-md"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{p.name}</div>
                <div className="text-caption text-foreground/55 line-clamp-2 mt-0.5">{p.description}</div>
              </div>
              <button
                type="button"
                className="btn-secondary h-7 px-2.5 text-[12px] shrink-0"
                onClick={() => handleApplyPreset(p)}
              >
                Configure
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add Custom Server Toggle & Form */}
      <div>
        {!showAddForm ? (
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 h-8 text-[13px]"
            onClick={() => {
              setShowAddForm(true);
              setFormError(null);
            }}
          >
            <Plus className="size-3.5" />
            <span>Add custom MCP server</span>
          </button>
        ) : (
          <form onSubmit={handleSave} className="surface p-4 space-y-3 rounded-md border border-black/[0.08]">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[14px] font-medium">Add MCP Server</span>
              <button
                type="button"
                className="btn-quiet text-[12px] h-6 px-1.5"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="eyebrow block mb-1">Server Name</label>
                <input
                  className="field"
                  placeholder="e.g. GitHub Tools"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="eyebrow block mb-1">ID (Slug)</label>
                <input
                  className="field font-mono text-[12px]"
                  placeholder="e.g. github"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="eyebrow block mb-1">Transport</label>
              <div className="flex gap-4 text-body-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="transport"
                    value="stdio"
                    checked={transport === "stdio"}
                    onChange={() => setTransport("stdio")}
                  />
                  <span>Command (stdio)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="transport"
                    value="http"
                    checked={transport === "http"}
                    onChange={() => setTransport("http")}
                  />
                  <span>Remote HTTP / SSE</span>
                </label>
              </div>
            </div>

            {transport === "stdio" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="eyebrow block mb-1">Command</label>
                  <input
                    className="field font-mono text-[12px]"
                    placeholder="npx or node"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                  />
                </div>
                <div>
                  <label className="eyebrow block mb-1">Arguments</label>
                  <input
                    className="field font-mono text-[12px]"
                    placeholder="-y @modelcontextprotocol/server-github"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="eyebrow block mb-1">Server URL</label>
                <input
                  className="field font-mono text-[12px]"
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="eyebrow block mb-1">Environment Variables (JSON, stored sealed)</label>
              <textarea
                className="field font-mono text-[11px] h-20 resize-y"
                placeholder='{"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."}'
                value={envStr}
                onChange={(e) => setEnvStr(e.target.value)}
              />
            </div>

            {formError && <div className="text-caption text-destructive">{formError}</div>}

            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn-primary h-8 px-4 text-[13px]" disabled={pending}>
                Save & Connect
              </button>
              <button
                type="button"
                className="btn-quiet h-8 px-3 text-[13px]"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
