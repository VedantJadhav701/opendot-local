"use client";

import { Suspense, use, useMemo, useState, useTransition } from "react";
import { Check, ChevronDown, ExternalLink, Hammer, LayoutGrid, Plus, Search, ShieldCheck, X, Zap } from "lucide-react";
import { connectApp, signInComposio } from "@/app/actions";
import { useStore } from "@/lib/store";
import { openAfter } from "@/lib/popup";

export type CatalogApp = {
  slug: string;
  name: string;
  description: string;
  logo: string;
  categories: string[];
  rank: number;
  tools: number;
  triggers: number;
  managed: boolean;
};

type Tab = "all" | "connected" | "instant";
type Sort = "popular" | "tools" | "az";

// Apps that work right away through Composio, no sign-in needed (Composio's "Instant Apps").
const INSTANT = ["serpapi", "firecrawl", "tavily", "exa", "elevenlabs", "peopledatalabs"];
const PAGE = 60;

const fmt = (n: number) => n.toLocaleString("en-US");

export default function AppsDirectory({ apps }: { apps: CatalogApp[] }) {
  const storeApps = useStore((s) => s.apps);
  const signedIn = useStore((s) => s.computer.composio);
  const connected = useMemo(() => new Set(storeApps.filter((a) => a.connected).map((a) => a.slug)), [storeApps]);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("popular");
  const [instantOnly, setInstantOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<CatalogApp | null>(null);

  const bySlug = useMemo(() => new Map(apps.map((a) => [a.slug, a])), [apps]);
  const instant = useMemo(() => INSTANT.flatMap((s) => bySlug.get(s) ?? []), [bySlug]);

  // Tab + search narrow the pool; categories are counted within it.
  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((a) => {
      if (tab === "connected" && !connected.has(a.slug)) return false;
      if ((tab === "instant" || instantOnly) && !INSTANT.includes(a.slug)) return false;
      return !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || a.description.toLowerCase().includes(q);
    });
  }, [apps, tab, query, instantOnly, connected]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of pool) for (const c of a.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1] - a[1]));
  }, [pool]);

  const list = useMemo(() => {
    const filtered = category ? pool.filter((a) => a.categories.includes(category)) : pool;
    const sorted = [...filtered];
    if (sort === "tools") sorted.sort((a, b) => b.tools - a.tools);
    else if (sort === "az") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => a.rank - b.rank || b.tools - a.tools);
    return sorted;
  }, [pool, category, sort]);

  const browsing = tab === "all" && !query.trim() && !category && !instantOnly && sort === "popular";
  const popular = apps.slice(0, 6);
  const reset = () => setLimit(PAGE);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/[0.06] bg-card px-3 py-2.5 sm:gap-3 sm:px-6">
        <div className="flex h-9 items-stretch rounded-md bg-black/[0.04] p-0.5">
          {(
            [
              ["all", "All", apps.length],
              ["connected", "Connected", connected.size],
              ["instant", "Instant", instant.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => (setTab(id), reset())}
              className={`flex items-center gap-2 rounded-[5px] px-3 text-[13px] transition-colors ${tab === id ? "bg-card shadow-xs" : "text-foreground/55 hover:text-foreground"}`}
            >
              {label}
              <span className={`rounded-xs px-1.5 font-mono text-[10px] leading-4 ${tab === id ? "bg-black/[0.06] text-foreground/70" : "bg-black/[0.04] text-foreground/45"}`}>
                {fmt(count)}
              </span>
            </button>
          ))}
        </div>

        <div className="relative order-last w-full sm:order-none sm:ml-auto sm:max-w-[340px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground/35" strokeWidth={1.75} />
          <input
            className="field pl-9"
            placeholder={`Search ${fmt(apps.length)} apps`}
            value={query}
            onChange={(e) => (setQuery(e.target.value), reset())}
          />
        </div>
        {!signedIn && (
          <button className="btn-brand shrink-0" onClick={() => void openAfter(signInComposio, () => {})}>
            Sign in with Composio
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-page gap-8 px-3 py-6 sm:px-6 sm:py-8 lg:grid-cols-[1fr_280px]">
          <main className="min-w-0 space-y-10">
            {browsing && (
              <>
                <Grid title="Popular">
                  {popular.map((a) => (
                    <AppCard key={a.slug} app={a} connected={connected.has(a.slug)} onOpen={setOpen} />
                  ))}
                </Grid>
                <Grid
                  title={
                    <span className="flex items-center gap-2">
                      <Zap className="size-4 fill-brand text-brand" strokeWidth={1.5} /> Instant Apps
                      <span className="rounded-xs border border-brand-readable/40 px-1.5 font-mono text-[10px] tracking-wider text-brand-readable uppercase">New</span>
                    </span>
                  }
                  action={
                    <button className="btn-quiet" onClick={() => (setTab("instant"), reset())}>
                      View all →
                    </button>
                  }
                >
                  {instant.map((a) => (
                    <AppCard key={a.slug} app={a} instant connected={connected.has(a.slug)} onOpen={setOpen} />
                  ))}
                </Grid>
              </>
            )}

            <Grid
              title={browsing ? "All apps" : category ?? (tab === "connected" ? "Connected" : tab === "instant" ? "Instant Apps" : query ? `Results for “${query}”` : "Apps")}
              count={list.length}
            >
              {list.slice(0, limit).map((a) => (
                <AppCard key={a.slug} app={a} instant={INSTANT.includes(a.slug)} connected={connected.has(a.slug)} onOpen={setOpen} />
              ))}
            </Grid>

            {!list.length && (
              <div className="surface py-12 text-center text-body-sm text-foreground/50">
                {tab === "connected" && !signedIn ? "Sign in with Composio to see your connected apps." : "No apps match."}
              </div>
            )}
            {list.length > limit && (
              <div className="flex justify-center">
                <button className="btn-secondary" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  Show more · {fmt(list.length - limit)} left
                </button>
              </div>
            )}
          </main>

          {/* Filters */}
          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <section className="surface overflow-hidden">
              <div className="border-b border-black/[0.06] px-4 py-3 text-[14px] font-medium">Filter & Sort</div>
              <div className="space-y-2 p-3">
                <label className="flex h-10 items-center justify-between rounded-md bg-popover px-3 text-body-sm">
                  <span className="text-foreground/55">Sort</span>
                  <span className="relative flex items-center">
                    <select
                      value={sort}
                      onChange={(e) => (setSort(e.target.value as Sort), reset())}
                      className="appearance-none bg-transparent pr-5 text-right outline-none"
                    >
                      <option value="popular">Popular</option>
                      <option value="tools">Most tools</option>
                      <option value="az">A–Z</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-0 size-3.5 text-foreground/40" />
                  </span>
                </label>
                <label className="flex h-10 cursor-pointer items-center justify-between rounded-md bg-popover px-3 text-body-sm">
                  <span className="text-foreground/55">Instant apps only</span>
                  <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={instantOnly} onChange={(e) => (setInstantOnly(e.target.checked), reset())} />
                </label>
              </div>
            </section>

            <section className="surface overflow-hidden">
              <div className="border-b border-black/[0.06] px-4 py-3 text-[14px] font-medium">Categories</div>
              <div className="max-h-[420px] space-y-px overflow-y-auto p-2">
                <CategoryRow label="All apps" count={pool.length} active={!category} onClick={() => (setCategory(null), reset())} icon />
                {categories.map(([c, n]) => (
                  <CategoryRow key={c} label={c} count={n} active={category === c} onClick={() => (setCategory(c), reset())} />
                ))}
              </div>
            </section>

            <a
              href="https://composio.dev/toolkits"
              target="_blank"
              rel="noreferrer"
              className="surface flex items-center justify-between px-4 py-3 text-[14px] transition-colors hover:border-black/15"
            >
              Browse on composio.dev
              <ExternalLink className="size-4 text-foreground/40" strokeWidth={1.5} />
            </a>
          </aside>
        </div>
      </div>

      {open && <AppDrawer app={open} connected={connected.has(open.slug)} signedIn={signedIn} instant={INSTANT.includes(open.slug)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Grid({ title, action, count, children }: { title: React.ReactNode; action?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-h2">
          {title}
          {count !== undefined && <span className="font-mono text-[11px] font-normal tracking-wider text-foreground/40">{fmt(count)}</span>}
        </h2>
        {action}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function AppLogo({ app, size = 36 }: { app: CatalogApp; size?: number }) {
  const [src, setSrc] = useState(app.logo);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={app.name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setSrc("/app-icons/default.svg")}
      className="shrink-0 rounded-md object-contain"
      style={{ width: size, height: size }}
    />
  );
}

function AppCard({ app, connected, instant, onOpen }: { app: CatalogApp; connected: boolean; instant?: boolean; onOpen: (a: CatalogApp) => void }) {
  return (
    <button
      onClick={() => onOpen(app)}
      className="surface group flex items-center gap-3.5 px-4 py-3.5 text-left transition-[border-color,box-shadow] hover:border-black/15 hover:shadow-elevated"
    >
      <AppLogo app={app} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {instant && <Zap className="size-3.5 shrink-0 text-foreground/50" strokeWidth={1.75} />}
          <span className="truncate text-[15px]">{app.name}</span>
          {app.managed && <ShieldCheck className="size-4 shrink-0 text-foreground/45" strokeWidth={1.75} aria-label="Managed by Composio" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-foreground/45">
          <Hammer className="size-3" strokeWidth={1.75} /> {fmt(app.tools)}
        </span>
      </span>
      {connected ? (
        <span className="shrink-0 text-[13px] text-success">1 Active</span>
      ) : (
        <span className="shrink-0 text-[12px] text-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Plus className="inline size-3.5" strokeWidth={2} /> Connect
        </span>
      )}
    </button>
  );
}

function CategoryRow({ label, count, active, icon, onClick }: { label: string; count: number; active: boolean; icon?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body-sm transition-colors ${active ? "bg-black/[0.05] text-foreground" : "text-foreground/65 hover:bg-black/[0.03] hover:text-foreground"}`}
    >
      {icon && <LayoutGrid className="size-3.5" strokeWidth={1.75} />}
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-[11px] text-foreground/40">{fmt(count)}</span>
    </button>
  );
}

// ---------- detail drawer ----------

type AppDetail = { error?: string; description: string; prompts: string[]; tools: { slug: string; name: string; description: string }[]; auth: string[] };
const details = new Map<string, Promise<AppDetail>>();
function loadDetail(slug: string): Promise<AppDetail> {
  let p = details.get(slug);
  if (!p) {
    p = fetch(`/api/apps/${slug}`).then((r) => r.json() as Promise<AppDetail>);
    details.set(slug, p);
  }
  return p;
}

function AppDrawer({ app, connected, signedIn, instant, onClose }: { app: CatalogApp; connected: boolean; signedIn: boolean; instant: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connect = () => start(() => openAfter(signedIn ? () => connectApp(app.slug) : signInComposio, setError));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/15" onClick={onClose}>
      <div className="flex h-full w-full max-w-[480px] flex-col border-l border-black/[0.06] bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4 border-b border-black/[0.06] p-6">
          <AppLogo app={app} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-h2">{app.name}</h2>
              {app.managed && <ShieldCheck className="size-4 text-foreground/45" strokeWidth={1.75} />}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {app.categories.map((c) => (
                <span key={c} className="rounded-xs bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-foreground/55 uppercase">
                  {c}
                </span>
              ))}
              {instant && <span className="rounded-xs bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-brand-readable uppercase">Instant</span>}
            </div>
          </div>
          <button className="btn-quiet size-8 p-0" onClick={onClose} aria-label="Close">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <p className="text-body-sm text-foreground/65">{app.description}</p>

          <dl className="grid grid-cols-3 divide-x divide-black/[0.06] rounded-lg border border-black/[0.06]">
            {[
              ["Tools", fmt(app.tools)],
              ["Triggers", fmt(app.triggers)],
              ["Auth", app.managed ? "Managed" : instant ? "Instant" : "Your key"],
            ].map(([k, v]) => (
              <div key={k} className="px-3 py-2.5">
                <dt className="eyebrow">{k}</dt>
                <dd className="mt-0.5 text-[15px]">{v}</dd>
              </div>
            ))}
          </dl>

          {connected ? (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3.5 py-2.5 text-body-sm text-success">
              <Check className="size-4" strokeWidth={2} /> Connected. Your dots can use {app.name}.
            </div>
          ) : (
            <div className="space-y-1.5">
              <button className="btn-primary h-10 w-full" disabled={pending} onClick={connect}>
                {signedIn ? `Connect ${app.name}` : "Sign in with Composio to connect"}
              </button>
              {error && <p className="text-caption text-destructive">{error}</p>}
              <p className="text-caption text-foreground/45">You&apos;ll sign in with {app.name} directly. Your dots never see your password.</p>
            </div>
          )}

          <Suspense fallback={<div className="text-body-sm text-foreground/45">Loading tools…</div>}>
            <DetailBody slug={app.slug} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function DetailBody({ slug }: { slug: string }) {
  const d = use(loadDetail(slug));
  const [q, setQ] = useState("");
  if (d.error) return <p className="text-body-sm text-foreground/50">{d.error}</p>;
  const tools = d.tools.filter((t) => !q || `${t.slug} ${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {d.prompts.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Try asking a dot</h3>
          <div className="space-y-1.5">
            {d.prompts.map((p) => (
              <div key={p} className="rounded-md bg-popover px-3 py-2 text-body-sm text-foreground/75">
                “{p}”
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Tools · {fmt(d.tools.length)}</h3>
        </div>
        {d.tools.length > 8 && <input className="field mb-2 h-8" placeholder="Filter tools" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="divide-y divide-black/[0.06] rounded-lg border border-black/[0.06]">
          {tools.slice(0, 200).map((t) => (
            <div key={t.slug} className="px-3 py-2">
              <div className="text-[13px]">{t.name || t.slug}</div>
              <div className="font-mono text-[10px] text-foreground/40">{t.slug}</div>
              {t.description && <div className="mt-0.5 line-clamp-2 text-caption text-foreground/55">{t.description}</div>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
