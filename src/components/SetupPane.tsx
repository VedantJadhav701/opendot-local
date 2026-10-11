"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Folder, RefreshCw, FolderPlus, Upload } from "lucide-react";
import * as actions from "@/app/actions";
import { addFolderAction, removeFolderAction, rescanFolderAction, listFoldersAction } from "@/app/folder-actions";
import { useStore } from "@/lib/store";
import LookEditor from "./LookEditor";
import { DotTriggers } from "./Triggers";
import Dot3DLazy from "./Dot3DLazy";
import { Empty, PageHeader, RemoveButton, RuleEditor, Section } from "./SettingsKit";
import { ExportPackButton, ImportPackDialog } from "./PackDialog";
import type { Dot, FolderInfo } from "@/lib/types";

const SCHEDULES = [
  { label: "Every morning", cron: "0 8 * * *" },
  { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Mondays", cron: "0 9 * * 1" },
];

export default function SetupPane({ dot }: { dot: Dot }) {
  const router = useRouter();
  const allRoutines = useStore((s) => s.routines);
  const allMemories = useStore((s) => s.memories);
  const allSkills = useStore((s) => s.skills);
  const routines = useMemo(() => allRoutines.filter((r) => r.dotId === dot.id), [allRoutines, dot.id]);
  const memories = useMemo(() => allMemories.filter((m) => m.dotId === dot.id), [allMemories, dot.id]);
  const skills = useMemo(() => allSkills.filter((k) => k.dotId === dot.id), [allSkills, dot.id]);

  const [name, setName] = useState(dot.name);
  const [purpose, setPurpose] = useState(dot.purpose);
  const [instructions, setInstructions] = useState(dot.instructions);
  const [look, setLook] = useState(dot.look);
  const [memory, setMemory] = useState("");
  const [routine, setRoutine] = useState({ name: "", instruction: "", schedule: "0 8 * * *" });
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [skillOpen, setSkillOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [pending, start] = useTransition();

  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderInput, setFolderInput] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [scanningFolderId, setScanningFolderId] = useState<string | null>(null);

  const loadFolders = () => {
    listFoldersAction(dot.id).then(setFolders).catch(() => {});
  };

  useEffect(() => {
    loadFolders();
  }, [dot.id]);

  const handlePickFolder = async () => {
    setFolderError(null);
    if (typeof window !== "undefined" && (window as any).electronAPI?.pickFolder) {
      try {
        const picked = await (window as any).electronAPI.pickFolder();
        if (picked) {
          const res = await addFolderAction(dot.id, picked);
          if (res.ok) {
            loadFolders();
          } else {
            setFolderError(res.error || "Could not add folder");
          }
        }
      } catch (err: any) {
        setFolderError(err?.message || "Failed to pick folder");
      }
    }
  };

  const handleAddFolderManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderInput.trim()) return;
    setFolderError(null);
    start(async () => {
      const res = await addFolderAction(dot.id, folderInput.trim());
      if (res.ok) {
        setFolderInput("");
        loadFolders();
      } else {
        setFolderError(res.error || "Could not add folder");
      }
    });
  };

  const handleRescan = async (id: string) => {
    setScanningFolderId(id);
    start(async () => {
      await rescanFolderAction(id);
      setScanningFolderId(null);
      loadFolders();
    });
  };

  const handleRemoveFolder = async (id: string) => {
    start(async () => {
      await removeFolderAction(id);
      loadFolders();
    });
  };

  const dirty = name !== dot.name || purpose !== dot.purpose || instructions !== dot.instructions || JSON.stringify(look) !== JSON.stringify(dot.look);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="rails mx-auto min-h-full max-w-[1080px] px-4 sm:px-8 pb-16">
        <PageHeader eyebrow="Setup" title={`How ${dot.name} works`} description="Personality, rules, routines, memory, and skills. Your dot also updates these itself as you work together." />

        <div className="mb-6 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-2">
            <ExportPackButton dot={dot} />
            <button
              type="button"
              onClick={() => setShowImportDialog(true)}
              className="btn-secondary flex items-center gap-1.5 h-8 px-3 text-[13px]"
            >
              <Upload className="size-3.5" />
              <span>Import pack…</span>
            </button>
          </div>
        </div>

        <Section eyebrow="Identity" title="Personality & appearance" description="Its name, job, and how you want it to work.">
          <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
            <div className="space-y-4">
              <label className="block">
                <span className="eyebrow mb-1.5 block">Name</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className="eyebrow mb-1.5 block">Job</span>
                <input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What this dot is for" />
              </label>
              <label className="block">
                <span className="eyebrow mb-1.5 block">Instructions</span>
                <textarea
                  className="field h-auto min-h-28 resize-y py-2 leading-normal"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Tone, preferences, things to always or never do…"
                />
              </label>
              <div className="pt-2">
                <LookEditor look={look} onChange={setLook} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-3 lg:sticky lg:top-6 lg:self-start">
              <div className="dot-grid surface flex w-full justify-center py-2">
                <Dot3DLazy look={look} size={190} stage />
              </div>
              <button className="btn-primary w-full" disabled={!dirty || pending} onClick={() => start(() => actions.updateDot(dot.id, { name, purpose, instructions, look }))}>
                {dirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </div>
        </Section>

        <Section eyebrow="Approvals" title="Rules" description={`${dot.name} knows when to take action and when to ask for approval. Add custom rules for more control.`}>
          <RuleEditor dotId={dot.id} name={dot.name} />
        </Section>

        <Section eyebrow="Automation" title="Routines" description={`Recurring tasks ${dot.name} runs on a schedule. You can also just ask it in chat.`}>
          <div className="space-y-3">
            {routines.length > 0 ? (
              <div className="surface divide-y divide-black/[0.06]">
                {routines.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 py-3 pr-2 pl-4">
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${r.enabled ? "bg-success" : "bg-foreground/25"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px]">{r.name}</span>
                        <code className="rounded-xs bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-foreground/55">{r.schedule}</code>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-body-sm text-foreground/55">{r.instruction}</div>
                      <div className="mt-1 font-mono text-[10px] tracking-wider text-foreground/40 uppercase">
                        {r.enabled && r.nextRunAt ? `Next ${new Date(r.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Paused"}
                        {r.lastRunAt ? ` · Last ${new Date(r.lastRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                      </div>
                    </div>
                    <button className="btn-quiet" onClick={() => start(() => actions.runRoutineNow(r.id))}>
                      <Play className="size-3" strokeWidth={2} /> Run
                    </button>
                    <button className="btn-quiet" onClick={() => start(() => actions.toggleRoutine(r.id, !r.enabled))}>
                      {r.enabled ? "Pause" : "Resume"}
                    </button>
                    <RemoveButton label="Delete routine" onClick={() => start(() => actions.deleteRoutine(r.id))} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No routines yet. Try &ldquo;Every weekday at 8am, brief me on AI news&rdquo; in chat.</Empty>
            )}
            <form
              className="surface space-y-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const err = await actions.addRoutine(dot.id, routine.name, routine.instruction, routine.schedule);
                  setRoutineError(err);
                  if (!err) setRoutine({ name: "", instruction: "", schedule: "0 8 * * *" });
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <input className="field" placeholder="Name" value={routine.name} onChange={(e) => setRoutine({ ...routine, name: e.target.value })} />
                <input className="field" placeholder="What to do each time" value={routine.instruction} onChange={(e) => setRoutine({ ...routine, instruction: e.target.value })} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {SCHEDULES.map((s) => (
                  <button
                    key={s.cron}
                    type="button"
                    onClick={() => setRoutine({ ...routine, schedule: s.cron })}
                    className={`h-8 rounded-md border px-2.5 text-[13px] transition-colors ${routine.schedule === s.cron ? "border-foreground bg-foreground text-card" : "border-black/10 text-foreground/70 hover:border-black/25"}`}
                  >
                    {s.label}
                  </button>
                ))}
                <input className="field h-8 w-36 font-mono text-[12px]" value={routine.schedule} onChange={(e) => setRoutine({ ...routine, schedule: e.target.value })} aria-label="Cron schedule" />
                <button className="btn-primary ml-auto h-8 px-3 text-[13px]" disabled={pending || !routine.instruction.trim()}>
                  Add routine
                </button>
              </div>
              {routineError && <p className="text-caption text-destructive">{routineError}</p>}
            </form>
          </div>
        </Section>

        <Section eyebrow="Automation" title="Triggers" description={`Wake ${dot.name} when something happens in your apps, like a new email or a Slack mention. It runs in its own chat and still asks before sending anything.`}>
          <DotTriggers dot={dot} />
        </Section>

        <Section eyebrow="Memory" title="What it knows about you" description={`${dot.name} adds to this as you work together. Remove anything that's wrong.`}>
          <div className="space-y-3">
            {memories.length > 0 ? (
              <div className="surface divide-y divide-black/[0.06]">
                {memories.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
                    <span className="flex-1 text-body-sm">{m.text}</span>
                    <RemoveButton label="Forget" onClick={() => start(() => actions.deleteMemory(m.id))} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Nothing yet.</Empty>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(() => actions.addMemory(dot.id, memory));
                setMemory("");
              }}
            >
              <input className="field" placeholder="Add something it should remember" value={memory} onChange={(e) => setMemory(e.target.value)} />
              <button className="btn-secondary shrink-0" disabled={!memory.trim()}>
                Add
              </button>
            </form>
          </div>
        </Section>

        <Section
          eyebrow="Knowledge"
          title="Knowledge folders"
          description={`Point ${dot.name} at folders on this computer. It indexes text and PDFs locally in .data/ so you can ask questions with citations.`}
        >
          <div className="space-y-3">
            {folders.length > 0 ? (
              <div className="surface divide-y divide-black/[0.06]">
                {folders.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 py-3 pr-2 pl-4">
                    <Folder className="size-4 shrink-0 text-foreground/45" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px] text-foreground/80" title={f.path}>
                          {f.path}
                        </span>
                        <span
                          className={`rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                            f.status === "scanning" || scanningFolderId === f.id
                              ? "bg-warning/15 text-warning font-semibold"
                              : "bg-black/[0.04] text-foreground/55"
                          }`}
                        >
                          {f.status === "scanning" || scanningFolderId === f.id ? "scanning" : "indexed"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-body-sm text-foreground/50">
                        {f.files} files · {f.chunks} chunks
                        {f.lastScanAt ? ` · Last scanned ${new Date(f.lastScanAt).toLocaleTimeString()}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="btn-quiet flex items-center gap-1 h-7 px-2 text-[12px]"
                        disabled={pending || scanningFolderId === f.id}
                        onClick={() => handleRescan(f.id)}
                        title="Rescan folder"
                      >
                        <RefreshCw className={`size-3 ${scanningFolderId === f.id ? "animate-spin" : ""}`} />
                        <span>Rescan</span>
                      </button>
                      <RemoveButton label="Remove folder" onClick={() => handleRemoveFolder(f.id)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No folders added yet.</Empty>
            )}

            {folderError && <div className="text-body-sm text-destructive">{folderError}</div>}

            <div className="flex flex-wrap gap-2 pt-1">
              {typeof window !== "undefined" && (window as any).electronAPI?.pickFolder && (
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-2"
                  onClick={handlePickFolder}
                  disabled={pending}
                >
                  <FolderPlus className="size-4" />
                  <span>Choose folder…</span>
                </button>
              )}
              <form className="flex flex-1 min-w-[280px] gap-2" onSubmit={handleAddFolderManual}>
                <input
                  className="field flex-1"
                  placeholder="Or enter absolute folder path…"
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                />
                <button className="btn-secondary shrink-0" disabled={!folderInput.trim() || pending}>
                  Add folder
                </button>
              </form>
            </div>
          </div>
        </Section>

        <Section eyebrow="Skills" title="Repeatable know-how" description="Markdown instructions it follows for tasks it repeats. Ask your dot to save one after it figures something out.">
          {skills.length > 0 ? (
            <div className="surface divide-y divide-black/[0.06]">
              {skills.map((k) => (
                <div key={k.id} className="py-2.5 pr-2 pl-4">
                  <div className="flex items-center gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSkillOpen(skillOpen === k.id ? null : k.id)}>
                      <span className="block text-[14px]">{k.name}</span>
                      <span className="block truncate text-body-sm text-foreground/55">{k.description}</span>
                    </button>
                    <RemoveButton label="Delete skill" onClick={() => start(() => actions.deleteSkill(k.id))} />
                  </div>
                  {skillOpen === k.id && <pre className="mt-2 mr-2 rounded-md bg-popover p-3 font-mono text-[12px] whitespace-pre-wrap text-foreground/75">{k.body}</pre>}
                </div>
              ))}
            </div>
          ) : (
            <Empty>No skills yet.</Empty>
          )}
        </Section>

        <Section eyebrow="Danger zone" title={`Delete ${dot.name}`} description="Removes its chat, memory, routines, triggers, and computer. This can't be undone.">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button className="btn bg-destructive text-card hover:opacity-90" onClick={() => start(async () => (await actions.deleteDot(dot.id), router.push("/")))}>
                Yes, delete {dot.name}
              </button>
              <button className="btn-quiet" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-secondary text-destructive" onClick={() => setConfirmDelete(true)}>
              Delete {dot.name}…
            </button>
          )}
        </Section>

        {showImportDialog && (
          <ImportPackDialog onClose={() => setShowImportDialog(false)} />
        )}
      </div>
    </div>
  );
}
