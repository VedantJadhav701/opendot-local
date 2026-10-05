import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, id } from "./db";
import * as computer from "./computer";
import type { Attachment } from "@/lib/types";

// Files that move between the user and a dot. The canonical copy lives in .data/files/<id>
// (for previews and downloads); a working copy goes into the dot's computer so it can use it.

const DIR = path.join(DATA_DIR, "files");
export const MAX_UPLOAD = 25 * 1024 * 1024;

type Row = { id: string; dot_id: string; name: string; mime: string; size: number; source: string; box_path: string | null; created_at: number };

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";

export function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return (
    {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
      ".html": "text/html", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".doc": "application/msword",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".ppt": "application/vnd.ms-powerpoint",
      ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar",
      ".py": "text/x-python", ".js": "text/javascript", ".ts": "text/typescript", ".tsx": "text/typescript", ".jsx": "text/javascript",
      ".jsonl": "application/x-jsonlines", ".yaml": "text/yaml", ".yml": "text/yaml", ".sh": "text/x-shellscript", ".bat": "text/plain",
      ".ps1": "text/plain", ".sql": "text/x-sql", ".c": "text/x-c", ".cpp": "text/x-c++", ".rs": "text/x-rust", ".go": "text/x-go",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

function save(dotId: string, name: string, mime: string, data: Buffer, source: "user" | "dot", boxPath: string | null): Attachment {
  fs.mkdirSync(DIR, { recursive: true });
  const fileId = id("file");
  fs.writeFileSync(path.join(DIR, fileId), data);
  db()
    .prepare("INSERT INTO files (id, dot_id, name, mime, size, source, box_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fileId, dotId, name, mime, data.length, source, boxPath, Date.now());
  return { id: fileId, name, mime, size: data.length };
}

import { extractPdf, isPdfBuffer } from "./context/pdf";
import { chunkText } from "./context/chunker";
import { saveChunks } from "./context/db";

/** The user attached a file: store it and put a copy in the dot's workspace under uploads/. */
export async function upload(dotId: string, name: string, mime: string, data: Buffer): Promise<Attachment & { boxPath: string }> {
  const clean = safeName(name);
  const boxPath = await computer.writeFile(dotId, `uploads/${clean}`, data);
  const att = save(dotId, clean, mime || guessMime(clean), data, "user", boxPath);

  if (att.mime === "application/pdf" || clean.toLowerCase().endsWith(".pdf") || isPdfBuffer(data)) {
    try {
      const pdfRes = await extractPdf(data);
      const taskId = `task_${att.id}`;
      const chunks = chunkText({
        text: pdfRes.fullText,
        source: clean,
        taskId,
        dotId,
      });
      saveChunks(chunks);
    } catch (err) {
      console.error("[pdf] Failed to chunk uploaded PDF", err);
    }
  }

  return { ...att, boxPath };
}

/** The dot shares a file from its computer with the user. */
export async function shareFromComputer(dotId: string, p: string): Promise<Attachment> {
  const data = await computer.readFile(dotId, p);
  if (data.length > MAX_UPLOAD * 4) throw new Error("That file is too large to share (over 100 MB).");
  const name = safeName(path.basename(p));
  return save(dotId, name, guessMime(name), data, "dot", p);
}

export function get(fileId: string): (Attachment & { dotId: string; boxPath: string | null; data: () => Buffer }) | null {
  const r = db().prepare("SELECT * FROM files WHERE id = ?").get(fileId) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id, name: r.name, mime: r.mime, size: r.size, dotId: r.dot_id, boxPath: r.box_path,
    data: () => fs.readFileSync(path.join(DIR, r.id)),
  };
}

export function boxPathOf(fileId: string): string | null {
  return get(fileId)?.boxPath ?? null;
}
