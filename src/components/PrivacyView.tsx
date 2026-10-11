"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Globe, Lock, RefreshCw, Shield, Trash2, Wifi, WifiOff } from "lucide-react";
import {
  clearPrivacyLog,
  exportPrivacyCsv,
  getPrivacyLog,
  getPrivacySummary,
  setOfflineMode,
  setSearchEndpoint,
  type PrivacyLogEntry,
  type PrivacySummary,
} from "@/app/privacy-actions";

export default function PrivacyView() {
  const [summary, setSummary] = useState<PrivacySummary | null>(null);
  const [logs, setLogs] = useState<PrivacyLogEntry[]>([]);
  const [showLocal, setShowLocal] = useState(false);
  const [searchEndpointInput, setSearchEndpointInput] = useState("");
  const [isSavingEndpoint, setIsSavingEndpoint] = useState(false);
  const [pending, start] = useTransition();

  const loadData = async () => {
    try {
      const [sum, list] = await Promise.all([getPrivacySummary(24), getPrivacyLog(150)]);
      setSummary(sum);
      setLogs(list);
      setSearchEndpointInput(sum.searchEndpoint);
    } catch (err) {
      console.error("Failed to load privacy data:", err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleOffline = (on: boolean) => {
    start(async () => {
      await setOfflineMode(on);
      await loadData();
    });
  };

  const handleClear = () => {
    start(async () => {
      await clearPrivacyLog();
      await loadData();
    });
  };

  const handleExportCsv = async () => {
    const csv = await exportPrivacyCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `opendot-privacy-log-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveSearchEndpoint = () => {
    setIsSavingEndpoint(true);
    start(async () => {
      await setSearchEndpoint(searchEndpointInput);
      await loadData();
      setIsSavingEndpoint(false);
    });
  };

  const internetLogs = logs.filter((l) => l.scope === "internet");
  const localLogs = logs.filter((l) => l.scope === "local");

  return (
    <div className="space-y-6">
      {/* 24h Summary Card */}
      <div className="surface rounded-xl p-5 border border-black/[0.06]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Shield className="size-5 text-brand-readable" />
            <div>
              <div className="font-medium text-[15px]">Outbound Network Activity (Past 24 Hours)</div>
              <div className="text-body-sm text-foreground/55 mt-0.5">
                {summary
                  ? `${summary.internetRequests} requests left this computer, to ${summary.uniqueHosts} external sites.`
                  : "Loading privacy audit summary…"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="btn-secondary h-8 px-3 text-[13px] flex items-center gap-1.5"
            >
              <Download className="size-3.5" /> Export CSV
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={pending}
              className="btn-secondary h-8 px-3 text-[13px] flex items-center gap-1.5 text-destructive"
            >
              <Trash2 className="size-3.5" /> Clear Log
            </button>
          </div>
        </div>

        {summary && !summary.cloudBoostActive && (
          <div className="mt-4 rounded-lg bg-success/10 border border-success/20 p-3 text-caption text-success font-medium flex items-center gap-2">
            <Lock className="size-4 shrink-0" />
            0 requests carried your private files or chats. All reasoning remained 100% on this machine.
          </div>
        )}

        {summary?.cloudBoostActive && (
          <div className="mt-4 rounded-lg bg-warning/10 border border-warning/20 p-3 text-caption text-warning font-medium flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            Cloud Boost is ON: Outbound prompts are sent to {summary.cloudBoostHost}.
          </div>
        )}

        {summary?.composioConnected && (
          <div className="mt-2 rounded-lg bg-warning/10 border border-warning/20 p-3 text-caption text-warning font-medium flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            Apps via Composio: Connected. Content from your connected third-party apps passes through Composio&apos;s servers.
          </div>
        )}
      </div>

      {/* Offline Mode Switch */}
      <div className="surface rounded-xl p-5 border border-black/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-3">
          {summary?.offline ? <WifiOff className="size-5 text-warning" /> : <Wifi className="size-5 text-foreground/50" />}
          <div>
            <div className="font-medium text-[15px]">Strict Offline Mode</div>
            <div className="text-body-sm text-foreground/55">
              Blocks all outbound network connections. Dots cannot search the web or fetch external pages, and Cloud Boost is disabled.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleToggleOffline(!summary?.offline)}
          disabled={pending}
          className={`h-9 px-4 rounded-full text-[13px] font-medium transition-colors ${
            summary?.offline
              ? "bg-warning text-black hover:bg-warning/90"
              : "bg-black/[0.06] text-foreground/70 hover:bg-black/[0.1]"
          }`}
        >
          {summary?.offline ? "Offline Mode Enabled" : "Offline Mode Disabled"}
        </button>
      </div>

      {/* Search Endpoint setting */}
      <div className="surface rounded-xl p-5 border border-black/[0.06] space-y-3">
        <div className="font-medium text-[15px]">Search Endpoint</div>
        <div className="text-body-sm text-foreground/55">
          By default, web searches use DuckDuckGo. You can point this to your self-hosted SearXNG or private search instance:
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1 h-9 px-3 text-[13px]"
            value={searchEndpointInput}
            onChange={(e) => setSearchEndpointInput(e.target.value)}
            placeholder="https://html.duckduckgo.com/html or http://localhost:8080"
          />
          <button
            type="button"
            onClick={handleSaveSearchEndpoint}
            disabled={isSavingEndpoint || pending}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            Save
          </button>
        </div>
      </div>

      {/* Request Log Table */}
      <div className="surface rounded-xl border border-black/[0.06] overflow-hidden">
        <div className="p-4 border-b border-black/[0.06] font-medium text-[14px]">
          Outbound Internet Requests ({internetLogs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-black/[0.02] text-foreground/50 border-b border-black/[0.06]">
              <tr>
                <th className="py-2.5 px-4 font-medium">Time</th>
                <th className="py-2.5 px-4 font-medium">Host</th>
                <th className="py-2.5 px-4 font-medium">Path</th>
                <th className="py-2.5 px-4 font-medium">Reason</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {internetLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-foreground/45">
                    No external internet requests recorded yet.
                  </td>
                </tr>
              ) : (
                internetLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-black/[0.01]">
                    <td className="py-2.5 px-4 text-foreground/45 whitespace-nowrap">
                      {new Date(log.ts).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 font-medium">{log.host}</td>
                    <td className="py-2.5 px-4 text-foreground/60 max-w-[200px] truncate">{log.path || "/"}</td>
                    <td className="py-2.5 px-4">
                      <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-mono text-foreground/70">
                        {log.reason || "unknown"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-foreground/60">{log.status ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collapsible Local Log Table */}
      <div className="surface rounded-xl border border-black/[0.06] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowLocal(!showLocal)}
          className="w-full p-4 flex items-center justify-between text-left font-medium text-[14px] hover:bg-black/[0.01]"
        >
          <div className="flex items-center gap-2">
            {showLocal ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <span>On This Computer (Local & Loopback: {localLogs.length})</span>
          </div>
          <span className="text-caption text-foreground/40">{showLocal ? "Collapse" : "Expand"}</span>
        </button>

        {showLocal && (
          <div className="border-t border-black/[0.06] overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-black/[0.02] text-foreground/50 border-b border-black/[0.06]">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Time</th>
                  <th className="py-2.5 px-4 font-medium">Host</th>
                  <th className="py-2.5 px-4 font-medium">Path</th>
                  <th className="py-2.5 px-4 font-medium">Reason</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {localLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-foreground/45">
                      No local requests logged.
                    </td>
                  </tr>
                ) : (
                  localLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-black/[0.01]">
                      <td className="py-2.5 px-4 text-foreground/45 whitespace-nowrap">
                        {new Date(log.ts).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-medium">{log.host}</td>
                      <td className="py-2.5 px-4 text-foreground/60 max-w-[200px] truncate">{log.path || "/"}</td>
                      <td className="py-2.5 px-4">
                        <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-mono text-foreground/70">
                          {log.reason || "local"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-foreground/60">{log.status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
