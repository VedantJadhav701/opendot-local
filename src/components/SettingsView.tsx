"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, Cpu, KeyRound, Lock, LogOut, Plus, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { connectApp, deletePassword, refreshApps, savePassword, setDefaultModel, signInComposio, signOutComposio } from "@/app/actions";
import { useStore } from "@/lib/store";
import { openAfter } from "@/lib/popup";
import { Empty, PageHeader, RemoveButton, RuleEditor, Section } from "./SettingsKit";
import ModelPicker from "./ModelPicker";
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
          <div className="surface mb-3 flex items-center gap-3 p-4">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Default Model</div>
              <div className="text-body-sm text-foreground/55">Used by every dot that doesn&apos;t pick its own model.</div>
            </div>
            <ModelPicker allowDefault={false} value={computer.model || null} onChange={(m) => start(() => setDefaultModel(m))} />
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
          id="apps"
          eyebrow="Apps"
          title="Your apps, via Composio (Optional)"
          description="Optionally sign in with your Composio account to connect Gmail, Calendar, Slack, Notion, GitHub, and more."
        >
          <AppsList />
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
            <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-success uppercase">Active & Connected</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            Running locally on <code>http://127.0.0.1:11434</code>. Free, private, and offline-capable.
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
  const [pending, start] = useTransition();
  const connected = apps.filter((a) => a.connected);
  const suggested = apps.filter((a) => !a.connected);

  if (!signedIn) {
    return (
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-4 p-5">
          <div className="flex -space-x-2">
            {["gmail", "googlecalendar", "slack", "notion", "github"].map((slug) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={slug} src={`https://logos.composio.dev/api/${slug}`} alt="" className="size-8 rounded-full border-2 border-card bg-card object-contain p-1 shadow-sm" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Composio Integration (Optional)</div>
            <div className="text-body-sm text-foreground/55">Sign in to connect dots with Gmail, Slack, Notion, GitHub, and 500+ apps.</div>
          </div>
          <button
            className="btn-primary shrink-0"
            disabled={pending}
            onClick={() => start(() => openAfter(signInComposio, setError))}
          >
            Sign in with Composio
          </button>
        </div>
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
        <img src="https://logos.composio.dev/api/composio" alt="" className="size-6 rounded-xs object-contain" />
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
