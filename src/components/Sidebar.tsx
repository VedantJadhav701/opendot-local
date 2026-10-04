"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Search, Settings, SquarePen, Trash2, X } from "lucide-react";
import { deleteConversation } from "@/app/actions";
import { markRead, useStore } from "@/lib/store";
import { setSidebarOpen, useSidebarOpen } from "@/lib/ui";
import { statusDot, timeAgo } from "@/lib/status";
import DotOrb from "./DotOrb";
import type { Conversation, Message } from "@/lib/types";

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1">
        <span className="size-3 rounded-full bg-foreground ring-2 ring-card" />
        <span className="size-3 rounded-full bg-brand ring-2 ring-card" />
        <span className="size-3 rounded-full bg-highlight ring-2 ring-card" />
      </span>
      <span className="text-[15px] font-medium tracking-tight">open dot local</span>
    </span>
  );
}

/** Last readable line of a conversation, for the preview under its title. */
function preview(messages: Message[], convId: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.conversationId !== convId) continue;
    if (m.role === "card" && m.card?.status === "pending") return `Needs you: ${m.card.title}`;
    if ((m.role === "dot" || m.role === "user") && m.text) return (m.role === "user" ? "You: " : "") + m.text.replace(/[#*_`>|[\]]/g, "").replace(/\s+/g, " ");
  }
  return "";
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeConv = useSearchParams().get("c");
  const dots = useStore((s) => s.dots);
  const messages = useStore((s) => s.messages);
  const lastRead = useStore((s) => s.lastRead);
  const conversations = useStore((s) => s.conversations);
  const loaded = useStore((s) => s.loaded);
  const connected = useStore((s) => s.connected);
  const model = useStore((s) => s.computer.model);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [, start] = useTransition();
  const activeDot = pathname.match(/^\/dots\/([^/]+)/)?.[1];
  const drawerOpen = useSidebarOpen();

  const dotById = useMemo(() => new Map(dots.map((d) => [d.id, d])), [dots]);

  // Chat history across every dot, newest first; search matches titles, dot names, and message text.
  const recent = useMemo(() => {
    const query = q.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query) return sorted;
    const hits = new Set(messages.filter((m) => m.conversationId && m.text.toLowerCase().includes(query)).map((m) => m.conversationId));
    return sorted.filter((c) => c.title.toLowerCase().includes(query) || hits.has(c.id) || dotById.get(c.dotId)?.name.toLowerCase().includes(query));
  }, [conversations, messages, q, dotById]);

  const unread = (c: Conversation) => {
    const since = lastRead[c.dotId];
    return since !== undefined && c.updatedAt > since && messages.some((m) => m.conversationId === c.id && m.role === "dot" && m.createdAt > since);
  };

  const remove = (c: Conversation) =>
    start(async () => {
      await deleteConversation(c.id);
      setConfirming(null);
      if (c.id === activeConv) router.push(`/dots/${c.dotId}`);
    });

  const closeSearch = () => (setSearching(false), setQ(""));

  return (
    <>
      {/* Phones / narrow windows: the sidebar is a drawer over a dimmed backdrop */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/25 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside
        // Picking anything in the drawer closes it.
        onClickCapture={(e) => (e.target as HTMLElement).closest("a") && setSidebarOpen(false)}
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] shrink-0 flex-col bg-background shadow-2xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:shadow-none ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-1 px-4">
        <Link href="/" className="mr-auto">
          <Wordmark />
        </Link>
        <button
          className={`flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground ${searching ? "bg-card" : ""}`}
          onClick={() => (searching ? closeSearch() : setSearching(true))}
          title="Search chats"
          aria-label="Search chats"
        >
          <Search className="size-4" strokeWidth={1.75} />
        </button>
        <Link
          href="/"
          className="flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground"
          title="New chat"
          aria-label="New chat"
        >
          <SquarePen className="size-4" strokeWidth={1.75} />
        </Link>
      </div>

      {searching && (
        <div className="relative mx-3 mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground/35" strokeWidth={1.75} />
          <input
            autoFocus
            className="field h-9 bg-popover pr-8 pl-8"
            placeholder="Search chats and dots"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeSearch()}
          />
          <button className="absolute top-1/2 right-2.5 -translate-y-1/2 text-foreground/40 hover:text-foreground" onClick={closeSearch} aria-label="Close search">
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Your dots: a horizontal row of characters */}
      {!q && (
        <div className="shrink-0 pb-1">
          <div className="flex gap-0.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none]">
            {dots.map((d) => (
              <Link
                key={d.id}
                href={`/dots/${d.id}`}
                onClick={() => markRead(d.id)}
                className={`flex w-[54px] shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${activeDot === d.id ? "bg-black/[0.05]" : "hover:bg-black/[0.03]"}`}
                title={`${d.name}${d.purpose ? ` · ${d.purpose}` : ""}`}
              >
                <span className="relative">
                  <DotOrb look={d.look} status={d.status} size={40} />
                  {d.status !== "idle" && <span className={`absolute right-0 bottom-0.5 size-2.5 rounded-full ring-2 ring-card ${statusDot(d)}`} />}
                </span>
                <span className="w-full truncate text-center text-[11px] text-foreground/70">{d.name}</span>
              </Link>
            ))}
            <Link href="/new" className="flex w-[54px] shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 text-foreground/45 hover:bg-black/[0.03] hover:text-foreground" title="New dot">
              <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-black/20">
                <Plus className="size-4" strokeWidth={1.75} />
              </span>
              <span className="text-[11px]">New</span>
            </Link>
          </div>
        </div>
      )}

      {/* Recent chats */}
      {q && <div className="eyebrow shrink-0 px-4 pt-2 pb-1.5">Chats matching “{q}”</div>}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!loaded && <div className="px-2 py-2 text-body-sm text-foreground/45">Connecting…</div>}
        {recent.map((c) => {
          const d = dotById.get(c.dotId);
          if (!d) return null;
          if (confirming === c.id) {
            return (
              <div key={c.id} className="my-0.5 flex items-center gap-2 rounded-lg bg-destructive/[0.06] px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-destructive">Delete “{c.title}”?</span>
                <button className="btn-quiet h-7 px-2 text-[12px] text-destructive" onClick={() => remove(c)}>
                  Delete
                </button>
                <button className="btn-quiet size-7 p-0" onClick={() => setConfirming(null)} aria-label="Cancel">
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            );
          }
          const line = preview(messages, c.id);
          return (
            <div key={c.id} className={`group relative flex items-center rounded-xl transition-colors ${c.id === activeConv ? "bg-card shadow-2xs" : "hover:bg-black/[0.03]"}`}>
              <Link href={`/dots/${d.id}?c=${c.id}`} onClick={() => markRead(d.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5">
                <DotOrb look={d.look} status={d.status} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium">{c.title}</span>
                    {unread(c) && <span className="size-2 shrink-0 self-center rounded-full bg-brand" />}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground/35 group-hover:invisible">{timeAgo(c.updatedAt).replace(" ago", "")}</span>
                  </span>
                  <span className="block truncate text-[13px] text-foreground/50">
                    <span className="text-foreground/65">{d.name}</span>
                    {line ? ` · ${line}` : ""}
                  </span>
                </span>
              </Link>
              <button
                className="absolute top-2 right-2 hidden size-6 items-center justify-center rounded text-foreground/40 group-hover:flex hover:bg-black/[0.05] hover:text-destructive"
                onClick={() => setConfirming(c.id)}
                aria-label={`Delete ${c.title}`}
                title="Delete chat"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
        {loaded && !recent.length && (
          <p className="px-3 py-6 text-center text-caption text-foreground/45">
            {q ? "No chats match." : dots.length ? "No chats yet. Pick a dot above to start one." : "Create your first dot to start chatting."}
          </p>
        )}
      </nav>

      {/* Bottom */}
      <div className="flex shrink-0 items-center gap-2 p-3">
        <Link
          href="/apps"
          className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-full border text-[14px] transition-colors ${pathname === "/apps" ? "border-foreground bg-card" : "border-black/10 hover:border-black/25"}`}
        >
          <LayoutGrid className="size-4" strokeWidth={1.5} /> Apps
        </Link>
        <Link
          href="/settings"
          className={`relative flex size-10 items-center justify-center rounded-full border transition-colors ${pathname === "/settings" ? "border-foreground bg-card" : "border-black/10 hover:border-black/25"}`}
          title={`Settings · ${model || "model"} · ${connected ? "connected" : "reconnecting"}`}
          aria-label="Settings"
        >
          <Settings className="size-4" strokeWidth={1.5} />
          <span className={`absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-background ${connected ? "bg-success" : "bg-foreground/25"}`} />
        </Link>
      </div>
      </aside>
    </>
  );
}
