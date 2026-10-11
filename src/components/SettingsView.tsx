"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, Cpu, KeyRound, Lock, LogOut, Plus, RefreshCw, Server, ShieldCheck, AlertTriangle } from "lucide-react";
import { connectApp, deletePassword, getModelManagerState, installBrowserEngine, refreshApps, resetSetupDone, savePassword, setDefaultModel, signInComposio, signOutComposio, startDockerDesktop } from "@/app/actions";
import { useStore } from "@/lib/store";
import { openAfter } from "@/lib/popup";
import { Empty, PageHeader, RemoveButton, RuleEditor, Section } from "./SettingsKit";
import ModelPicker from "./ModelPicker";
import ModelSetup from "./ModelSetup";
import PrivacyView from "./PrivacyView";
import McpSection from "./McpSection";
import { TriggersKey } from "./Triggers";

const noop = () => () => {};
const notificationPermission = () => ("Notification" in window ? Notification.permission : "unsupported");

export default function SettingsView() {
  const passwords = useStore((s) => s.passwords);
  const computer = useStore((s) => s.computer);
  const permission = useSyncExternalStore(noop, notificationPermission, () => "default");
  const [, force] = useState(0);
  const [form, setForm] = useState({ site: "", username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="rails mx-auto min-h-full max-w-[1080px] px-4 sm:px-8 pb-16">
        <PageHeader eyebrow="Settings" title="Settings" description="Local AI engine, local computer sandbox, security, passwords, and dot rules." />

        <Section eyebrow="Engine" title="Local AI & Models" description="OpenDot-local runs fully on your machine using Ollama. No paid cloud inference required.">
          <OllamaCard />
          <ModelManagerCard />
          <div className="surface mb-3 flex items-center justify-between gap-3 p-4">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Default Model</div>
              <div className="text-body-sm text-foreground/55">Used by every dot that doesn&apos;t pick its own model.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary h-8 px-3 text-[13px]"
                onClick={() => start(() => resetSetupDone())}
                disabled={pending}
              >
                Run setup again
              </button>
              <ModelPicker allowDefault={false} value={computer.model || null} onChange={(m) => start(() => setDefaultModel(m))} />
            </div>
          </div>
          <dl className="surface divide-y divide-black/[0.06]">
            {[
              ["Local LLM Provider", "Ollama (http://127.0.0.1:11434)", true],
              ["Local Available Models", computer.models.length ? `${computer.models.length} models detected` : "Searching Ollama…", computer.models.length > 0],
              ["Computer Automation", computer.docker ? `Docker Container (${computer.image})` : "Local Cross-Platform Shell (PowerShell/zsh)", true],
              ["Browser Engine", "Playwright Local Chromium", true],
              ["Local Storage", "SQLite Database", true],
            ].map(([k, v, ok]) => (
              <div key={String(k)} className="flex items-center gap-4 px-4 py-2.5">
                <dt className="eyebrow w-48 shrink-0">{k}</dt>
                <dd className={`flex-1 text-body-sm ${ok ? "" : "text-warning"}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section eyebrow="Cloud Boost" title="Optional Cloud Provider" description="Optionally paste an API key for NVIDIA API Catalog or OpenAI-compatible endpoints. Stored encrypted in OS Vault. Local Ollama remains default.">
          <CloudBoostCard />
        </Section>

        <Section eyebrow="Privacy" title="Privacy & Network Ledger" description="OpenDot-local keeps your work on this computer. Inspect every outbound request, configure search endpoints, or switch on strict offline mode.">
          <PrivacyView />
        </Section>

        <Section
          eyebrow="Security & Secrets"
          title="Saved Logins"
          description="Your dots can securely use these to log into websites. Credentials are encrypted locally (DPAPI on Windows, Keychain on macOS), typed directly into the browser, and never sent to any remote servers."
        >
          <div className="space-y-3">
            {passwords.length > 0 ? (
              <div className="surface divide-y divide-black/[0.06]">
                {passwords.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
                    <KeyRound className="size-3.5 text-foreground/40" strokeWidth={1.75} />
                    <span className="w-40 truncate text-[14px]">{p.site}</span>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-foreground/55">{p.username}</span>
                    <span className="font-mono text-[12px] tracking-widest text-foreground/35">••••••••</span>
                    <RemoveButton label="Delete password" onClick={() => start(() => deletePassword(p.id))} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No saved logins yet.</Empty>
            )}
            <form
              className="surface space-y-3 p-4"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const err = await savePassword(form.site, form.username, form.password);
                  setError(err);
                  if (!err) setForm({ site: "", username: "", password: "" });
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="field" placeholder="Site, e.g. github.com" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
                <input className="field" placeholder="Username or email" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                <input className="field" type="password" placeholder="Password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-caption text-foreground/45">
                  <Lock className="size-3" strokeWidth={2} /> AES-256-GCM encrypted (DPAPI / Keychain)
                </span>
                {error && <span className="text-caption text-destructive">{error}</span>}
                <button className="btn-primary ml-auto h-8 px-3 text-[13px]" disabled={pending}>
                  Save login
                </button>
              </div>
            </form>
          </div>
        </Section>

        <Section eyebrow="Approvals" title="Rules for all dots" description="These apply to every dot, on top of each dot's own rules.">
          <RuleEditor dotId={null} name="a dot" />
        </Section>

        <Section
          id="connectors"
          eyebrow="Connectors"
          title="Connectors & External Tools"
          description="Two ways to connect tools: local MCP servers without a broker using your own credentials, or optional Composio for one-click cloud apps."
        >
          <div className="space-y-6">
            <div>
              <div className="text-[14px] font-medium mb-1">Your own tools (MCP, no broker)</div>
              <div className="text-body-sm text-foreground/55 mb-3">
                Run MCP servers on this machine. Tools and credentials stay local in your OS vault.
              </div>
              <McpSection />
            </div>

            <div className="border-t border-black/[0.06] pt-5">
              <div className="text-[14px] font-medium mb-1">Apps via Composio (optional account)</div>
              <div className="text-body-sm text-foreground/55 mb-3">
                Connect your everyday apps (Gmail, Slack, Notion) through Composio.
              </div>
              <AppsList />
            </div>
          </div>
        </Section>

        <Section
          id="triggers"
          eyebrow="Triggers"
          title="App Triggers (Optional)"
          description="Let a dot act when something happens, like a new email or a GitHub issue."
        >
          <TriggersKey />
        </Section>

        <Section eyebrow="Notifications" title="Desktop notifications" description={'Get notified when a dot finishes something or needs you.'}>
          <div className="surface flex items-center gap-3 p-4">
            <Bell className="size-4 text-foreground/50" strokeWidth={1.5} />
            <span className="flex-1 text-body-sm">
              {permission === "granted"
                ? "Notifications are on."
                : permission === "denied"
                  ? "Notifications are blocked in your browser settings."
                  : permission === "unsupported"
                    ? "This browser doesn't support notifications."
                    : "Notifications are off."}
            </span>
            {permission === "default" && (
              <button className="btn-primary h-8 px-3 text-[13px]" onClick={() => Notification.requestPermission().then(() => force((n) => n + 1))}>
                Turn on
              </button>
            )}
            {permission === "granted" && <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-success uppercase">On</span>}
          </div>
        </Section>
      </div>
    </div>
  );
}

function OllamaCard() {
  const computer = useStore((s) => s.computer);
  return (
    <div className="surface mb-3 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Cpu className="size-5" />
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-medium flex items-center gap-2">
            Ollama Local AI
          </div>
          <div className="text-body-sm text-foreground/55">
            Running locally on <code>http://127.0.0.1:11434</code>. Free, private, and offline-capable.
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelManagerCard() {
  const [state, setState] = useState<Awaited<ReturnType<typeof getModelManagerState>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = () => {
    start(async () => {
      try {
        setState(await getModelManagerState());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const connected = state?.connected ?? false;
  const defaultInstalled = state?.defaultInstalled ?? false;
  const profile = state?.profile;
  const browser = state?.browser;
  const statusRows = [
    ["Ollama", connected ? "Running" : "Missing or stopped", connected],
    ["Recommended model", defaultInstalled ? "Installed" : "Not installed", defaultInstalled],
    ["Docker", profile?.docker ? "Running" : "Not running", Boolean(profile?.docker)],
    ["GPU / VRAM", profile?.gpu ? `${profile.gpu}${profile.vramGB ? ` · ${profile.vramGB.toFixed(1)} GB` : ""}` : "No dedicated GPU detected", Boolean(profile?.gpu)],
    ["RAM", profile ? `${profile.ramGB.toFixed(1)} GB` : "Checking", Boolean(profile?.ramGB && profile.ramGB >= 8)],
    ["Disk", profile?.diskFreeGB ? `${profile.diskFreeGB.toFixed(1)} GB free` : "Unknown", Boolean(profile?.diskFreeGB && profile.diskFreeGB >= 8)],
    ["Browser", browser?.ok ? `${browser.channel} ready` : "Browser engine missing", Boolean(browser?.ok)],
  ] as const;

  return (
    <div className="surface mb-3 overflow-hidden">
      <div className="border-b border-black/[0.06] px-4 pt-4 pb-3">
        <div className="text-[14px] font-medium">Models</div>
        <div className="mt-1 text-body-sm text-foreground/55">
          OpenDot-local detects your computer and recommends an original model from the Ollama library. Download one, then choose it as the default.
        </div>
      </div>

      <ModelSetup onChanged={refresh} />

      <div className="border-t border-black/[0.06] px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="eyebrow">First-run health</div>
          <button className="btn-quiet h-7 px-2 text-[12px]" onClick={refresh} disabled={pending}>
            <RefreshCw className={`size-3 ${pending ? "animate-spin" : ""}`} strokeWidth={1.75} /> Check again
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {statusRows.map(([label, value, ok]) => (
            <div key={label} className="flex items-center gap-2 rounded-md border border-black/[0.08] bg-background px-3 py-2">
              <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
              <span className="w-24 shrink-0 text-caption text-foreground/45">{label}</span>
              <span className="min-w-0 flex-1 truncate text-body-sm">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!connected && <a className="btn-secondary h-8 px-3 text-[13px]" href="https://ollama.com/download" target="_blank" rel="noreferrer">Install Ollama</a>}
          {profile && !profile.docker && (
            <button className="btn-secondary h-8 px-3 text-[13px]" onClick={() => start(async () => { const err = await startDockerDesktop(); setError(err); refresh(); })} disabled={pending}>
              Start Docker
            </button>
          )}
          {browser && !browser.ok && (
            <button className="btn-secondary h-8 px-3 text-[13px]" onClick={() => start(async () => { const err = await installBrowserEngine(); setError(err); refresh(); })} disabled={pending}>
              Install browser engine
            </button>
          )}
        </div>
      </div>

      <PerformanceTuningSection />
      {error && <div className="border-t border-black/[0.06] px-4 py-2.5 text-caption text-destructive">{error}</div>}
    </div>
  );
}

function PerformanceTuningSection() {
  const [tuningData, setTuningData] = useState<{ tuning: any; perfMode: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loadTuning = () => {
    import("@/app/model-actions").then(({ getTuning }) => {
      getTuning().then(setTuningData).catch(() => {});
    });
  };

  useEffect(() => {
    loadTuning();
  }, []);

  const handleModeChange = (mode: string) => {
    start(async () => {
      const { setPerfMode } = await import("@/app/model-actions");
      await setPerfMode(mode);
      loadTuning();
    });
  };

  const copyText = (txt: string, label: string) => {
    navigator.clipboard.writeText(txt);
    setCopiedCmd(label);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  return (
    <div className="border-t border-black/[0.06] px-4 py-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-medium">Hardware Performance Mode</div>
          <div className="text-body-sm text-foreground/55 mt-0.5">
            Controls context window size and memory usage for local models.
          </div>
        </div>
        <select
          value={tuningData?.perfMode || "auto"}
          onChange={(e) => handleModeChange(e.target.value)}
          disabled={pending}
          className="input h-8 px-2 text-[13px] bg-background w-36"
        >
          <option value="auto">Auto (Hardware)</option>
          <option value="quality">Quality (16k)</option>
          <option value="balanced">Balanced (8k)</option>
          <option value="fast">Fast (4k)</option>
        </select>
      </div>

      {tuningData && (
        <div className="rounded-lg bg-black/[0.03] p-3 text-caption text-foreground/75">
          <span className="font-semibold text-foreground/90 capitalize">{tuningData.tuning.mode} Mode:</span> {tuningData.tuning.reason} (Context: {tuningData.tuning.numCtx.toLocaleString()} tokens)
        </div>
      )}

      {/* Make it faster recommendations */}
      <div className="rounded-xl border border-black/[0.08] bg-background p-4 space-y-3">
        <div className="font-medium text-[14px]">Make it faster (Ollama Server Optimizations)</div>
        <p className="text-caption text-foreground/60 leading-relaxed">
          Enable Flash Attention and quantized KV-cache in your system environment to increase throughput:
        </p>
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2 rounded bg-black/[0.03] px-3 py-2 text-caption font-mono">
            <span className="truncate">setx OLLAMA_FLASH_ATTENTION 1 && setx OLLAMA_KV_CACHE_TYPE q8_0</span>
            <button
              type="button"
              onClick={() => copyText("setx OLLAMA_FLASH_ATTENTION 1\nsetx OLLAMA_KV_CACHE_TYPE q8_0", "win")}
              className="btn-secondary h-6 px-2 text-[11px] shrink-0"
            >
              {copiedCmd === "win" ? "Copied!" : "Copy (Windows)"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 rounded bg-black/[0.03] px-3 py-2 text-caption font-mono">
            <span className="truncate">launchctl setenv OLLAMA_FLASH_ATTENTION 1</span>
            <button
              type="button"
              onClick={() => copyText("launchctl setenv OLLAMA_FLASH_ATTENTION 1\nlaunchctl setenv OLLAMA_KV_CACHE_TYPE q8_0", "mac")}
              className="btn-secondary h-6 px-2 text-[11px] shrink-0"
            >
              {copiedCmd === "mac" ? "Copied!" : "Copy (macOS)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppsList() {
  const apps = useStore((s) => s.apps);
  const signedIn = useStore((s) => s.computer.composio);
  const signInError = useSearchParams().get("composio_error");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [pending, start] = useTransition();
  const connected = apps.filter((a) => a.connected);
  const suggested = apps.filter((a) => !a.connected);

  const handleSignInClick = () => {
    if (typeof window !== "undefined" && !localStorage.getItem("composio_consent")) {
      setShowConsent(true);
      return;
    }
    start(() => openAfter(signInComposio, setError));
  };

  const handleConfirmConsent = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("composio_consent", "1");
    }
    setShowConsent(false);
    start(() => openAfter(signInComposio, setError));
  };

  if (!signedIn) {
    return (
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-4 p-5">
          <div className="flex -space-x-2">
            {["gmail", "googlecalendar", "slack", "notion", "github"].map((slug) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={slug} src={`/app-icons/${slug}.svg`} alt="" className="size-8 rounded-full border-2 border-card bg-card object-contain p-1 shadow-sm" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Composio Integration (Optional)</div>
            <div className="text-body-sm text-foreground/55">Sign in to connect dots with Gmail, Slack, Notion, GitHub, and 500+ apps.</div>
          </div>
          <button
            className="btn-primary shrink-0"
            disabled={pending}
            onClick={handleSignInClick}
          >
            Sign in with Composio
          </button>
        </div>
        {showConsent && (
          <div className="border-t border-black/[0.08] bg-popover p-4 space-y-3">
            <div className="text-[13px] font-medium text-warning flex items-center gap-1.5">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Third-party cloud service notice</span>
            </div>
            <p className="text-body-sm text-foreground/75">
              Composio is a third-party service. If you connect an app, its data (for example your email) passes through Composio&apos;s servers and your app logins are stored by Composio. OpenDot-local itself still runs locally. Continue?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary h-7 px-3 text-[12px]"
                onClick={handleConfirmConsent}
              >
                Continue to sign in
              </button>
              <button
                type="button"
                className="btn-quiet h-7 px-2.5 text-[12px]"
                onClick={() => setShowConsent(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {(error || signInError) && <div className="border-t border-black/[0.06] px-5 py-2.5 text-caption text-destructive">{error ?? signInError}</div>}
      </div>
    );
  }

  const connect = (slug: string) => {
    setBusy(slug);
    start(() => openAfter(() => connectApp(slug), setError).finally(() => setBusy(null)));
  };

  return (
    <div className="space-y-3">
      <div className="surface flex items-center gap-3 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icons/default.svg" alt="" className="size-6 rounded-xs object-contain" />
        <div className="flex-1">
          <div className="text-[14px]">Composio Apps</div>
          <div className="text-caption text-foreground/50">Signed in · {connected.length} app{connected.length === 1 ? "" : "s"} connected</div>
        </div>
        <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-success uppercase">Connected</span>
        <button className="btn-quiet" disabled={pending} onClick={() => start(() => refreshApps())} title="Refresh">
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
        </button>
        <button className="btn-quiet" disabled={pending} onClick={() => start(() => signOutComposio())}>
          <LogOut className="size-3.5" strokeWidth={1.75} /> Sign out
        </button>
      </div>

      {connected.length > 0 && (
        <div className="surface grid gap-px overflow-hidden bg-black/[0.06] sm:grid-cols-2">
          {connected.map((a) => (
            <div key={a.slug} className="flex items-center gap-3 bg-card px-4 py-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.logo} alt="" className="size-5 rounded-xs object-contain" />
              <span className="flex-1 truncate text-[14px]">{a.name}</span>
              <span className="size-1.5 rounded-full bg-success" title="Connected" />
            </div>
          ))}
        </div>
      )}

      {suggested.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Connect more</span>
            <a href="/apps" className="btn-quiet">Browse all apps →</a>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggested.map((a) => (
              <button
                key={a.slug}
                className="flex h-9 items-center gap-2 rounded-md border border-black/10 bg-card pr-3 pl-2 text-[13px] transition-colors hover:border-black/25"
                disabled={pending}
                onClick={() => connect(a.slug)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.logo} alt="" className="size-4 object-contain" />
                {busy === a.slug ? "Opening…" : a.name}
                <Plus className="size-3 text-foreground/40" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

function CloudBoostCard() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [modelId, setModelId] = useState("gpt-4o-mini");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSaveKey = () => {
    startTransition(async () => {
      const { saveCloudBoostKeyAction, setCloudBoostConfigAction } = await import("@/app/actions");
      await saveCloudBoostKeyAction(apiKey);
      await setCloudBoostConfigAction({ baseUrl, modelId });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div className="surface mb-6 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[14px] font-medium">Cloud Boost (Optional)</div>
          <div className="text-body-sm text-foreground/55">
            Connect an optional OpenAI-compatible API endpoint for cloud escalation. Key is encrypted in native OS Vault (DPAPI/Keychain). Off by default per dot.
          </div>
        </div>
      </div>
      <div className="space-y-3 pt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="eyebrow block mb-1">Base URL</label>
            <input
              type="text"
              className="w-full rounded border border-black/10 px-3 py-1.5 text-body-sm font-mono"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="eyebrow block mb-1">Model ID</label>
            <input
              type="text"
              className="w-full rounded border border-black/10 px-3 py-1.5 text-body-sm font-mono"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
        <div>
          <label className="eyebrow block mb-1">API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              className="flex-1 rounded border border-black/10 px-3 py-1.5 text-body-sm font-mono"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
            <button
              onClick={handleSaveKey}
              disabled={pending || !apiKey.trim()}
              className="rounded bg-accent px-4 py-1.5 text-body-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {pending ? "Saving..." : saved ? "Saved!" : "Save Key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
