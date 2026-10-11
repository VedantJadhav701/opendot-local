"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, AlertTriangle, Check, X, ShieldAlert, FileText } from "lucide-react";
import { exportDotPack, previewDotPack, importDotPack } from "@/app/pack-actions";
import type { Dot } from "@/lib/types";
import type { DotPack } from "@/lib/pack-schema";

export function ExportPackButton({ dot }: { dot: Dot }) {
  const [pending, startTransition] = useTransition();

  const handleExport = () => {
    startTransition(async () => {
      const res = await exportDotPack(dot.id);
      if (res.ok && res.json) {
        const blob = new Blob([res.json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${dot.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}.opendot.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    });
  };

  return (
    <button
      type="button"
      className="btn-secondary flex items-center gap-1.5 h-8 px-3 text-[13px]"
      disabled={pending}
      onClick={handleExport}
      title={`Export ${dot.name} as a shareable .opendot.json pack`}
    >
      <Download className="size-3.5" />
      <span>{pending ? "Exporting…" : "Export pack"}</span>
    </button>
  );
}

export function ImportPackDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<{
    pack: DotPack;
    warnings: string[];
    sha256: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result ?? "");
      setRawText(content);
      doPreview(content);
    };
    reader.readAsText(file);
  };

  const doPreview = (text: string) => {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const res = await previewDotPack(text);
      if (res.ok && res.pack && res.sha256) {
        setPreview({
          pack: res.pack,
          warnings: res.warnings || [],
          sha256: res.sha256,
        });
      } else {
        setError(res.error || "Could not parse dot pack.");
      }
    });
  };

  const handleConfirmImport = () => {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await importDotPack(rawText);
      if (res.ok && res.dotId) {
        onClose();
        router.push(`/dot/${res.dotId}`);
      } else {
        setError(res.error || "Failed to import dot.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="surface flex max-h-[85vh] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border border-black/10 shadow-elevated">
        <div className="flex items-center justify-between border-b border-black/[0.06] bg-popover px-5 py-3">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-foreground/60" />
            <span className="text-[14px] font-medium">Import Dot Pack</span>
          </div>
          <button type="button" className="btn-quiet size-7 p-0" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!preview ? (
            <div className="space-y-4">
              <div>
                <label className="eyebrow block mb-1.5">Upload a .opendot.json file</label>
                <input
                  type="file"
                  accept=".json,.opendot.json"
                  className="field file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:text-[12px] file:bg-black/5"
                  onChange={handleFileUpload}
                />
              </div>

              <div>
                <label className="eyebrow block mb-1.5">Or paste pack JSON directly</label>
                <textarea
                  className="field font-mono text-[11px] h-36 resize-y"
                  placeholder='{"format": "opendot.pack", "version": 1, ...}'
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
              </div>

              {error && <div className="text-body-sm text-destructive">{error}</div>}

              <button
                type="button"
                className="btn-primary"
                disabled={!rawText.trim() || pending}
                onClick={() => doPreview(rawText)}
              >
                {pending ? "Analyzing…" : "Review pack"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-black/[0.08] p-4 bg-card space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[16px] font-medium">{preview.pack.dot.name}</span>
                  <span className="font-mono text-[10px] text-foreground/45 uppercase">Pack v{preview.pack.version}</span>
                </div>
                {preview.pack.dot.purpose && (
                  <p className="text-body-sm text-foreground/70">{preview.pack.dot.purpose}</p>
                )}
                {preview.pack.author && (
                  <p className="text-caption text-foreground/40">Created by {preview.pack.author}</p>
                )}
              </div>

              {preview.warnings.length > 0 && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>Important details before importing</span>
                  </div>
                  <ul className="list-disc pl-5 text-body-sm text-foreground/80 space-y-0.5">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-3 text-body-sm">
                <div className="rounded border border-black/[0.06] p-2 bg-popover">
                  <span className="eyebrow block">Skills</span>
                  <span className="font-medium">{preview.pack.skills.length}</span>
                </div>
                <div className="rounded border border-black/[0.06] p-2 bg-popover">
                  <span className="eyebrow block">Routines</span>
                  <span className="font-medium">{preview.pack.routines.length} (off)</span>
                </div>
                <div className="rounded border border-black/[0.06] p-2 bg-popover">
                  <span className="eyebrow block">Rules</span>
                  <span className="font-medium">{preview.pack.rules.length}</span>
                </div>
              </div>

              <div>
                <span className="eyebrow block mb-1">SHA-256 fingerprint</span>
                <code className="block rounded bg-black/[0.04] p-1.5 font-mono text-[10px] break-all text-foreground/60">
                  {preview.sha256}
                </code>
              </div>

              {error && <div className="text-body-sm text-destructive">{error}</div>}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={pending}
                  onClick={handleConfirmImport}
                >
                  {pending ? "Importing…" : `Confirm & Import ${preview.pack.dot.name}`}
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setPreview(null)}
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
