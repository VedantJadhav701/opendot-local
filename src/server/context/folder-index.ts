import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { db, id } from "../db";
import { chunkText, type ChunkRecord } from "./chunker";
import { extractPdf, isPdfBuffer } from "./pdf";
import { saveChunks } from "./db";
import { filterChunks } from "./filter";
import { emit } from "../bus";

// "Ask my folder": the user points a dot at a folder; files are chunked into the same chunk_store the
// web/PDF pipeline uses (task_id = "folder:<id>"), plus an FTS5 index for fast first-pass retrieval.
// Everything stays on disk in .data/. Nothing is sent anywhere.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, dot_id TEXT NOT NULL, path TEXT NOT NULL, added_at INTEGER NOT NULL,
  last_scan_at INTEGER, files INTEGER DEFAULT 0, chunks INTEGER DEFAULT 0, status TEXT DEFAULT 'idle'
);
CREATE TABLE IF NOT EXISTS folder_files (
  folder_id TEXT NOT NULL, rel_path TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL,
  PRIMARY KEY (folder_id, rel_path)
);
`;

let ready = false;
let fts5Available = true;

const ensure = () => {
  if (!ready) {
    db().exec(SCHEMA);
    try {
      db().exec("CREATE VIRTUAL TABLE IF NOT EXISTS folder_fts USING fts5(text, chunk_id UNINDEXED, folder_id UNINDEXED);");
      fts5Available = true;
    } catch (err) {
      console.warn("[dots] FTS5 not supported in this SQLite build, falling back to in-memory search:", err);
      fts5Available = false;
    }
    ready = true;
  }
};

export const LIMITS = { maxFileBytes: 25 * 1024 * 1024, maxFiles: 5000, maxChunks: 50_000, maxDepth: 12 };
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".log", ".ini", ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".sql", ".sh", ".ps1", ".bat", ".tex"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "target", "__pycache__", ".venv", "venv", ".idea", ".vscode"]);
// Never index files that usually hold secrets.
const SECRET_FILE = /(^\.env(\..*)?$|id_rsa|id_ed25519|\.pem$|\.key$|\.pfx$|\.p12$|\.kdbx$|credentials|secrets?\.(json|ya?ml|txt)$)/i;

export function addFolder(dotId: string, folderPath: string): { id: string } {
  ensure();
  const real = fs.realpathSync(folderPath);
  if (!fs.statSync(real).isDirectory()) throw new Error("That path is not a folder.");
  // Refuse drive roots and the home directory itself: too broad, and almost always a mistake.
  if (path.parse(real).root === real) throw new Error("Choose a folder, not a whole drive.");
  const home = os.homedir();
  try {
    if (real === home || real === fs.realpathSync(home)) throw new Error("Choose a subfolder, not your entire home directory.");
  } catch (e: any) {
    if (e.message.includes("subfolder")) throw e;
  }

  const row = db().prepare("SELECT id FROM folders WHERE dot_id = ? AND path = ?").get(dotId, real) as { id: string } | undefined;
  if (row) return { id: row.id };
  const folderId = id("fld");
  db().prepare("INSERT INTO folders (id, dot_id, path, added_at) VALUES (?, ?, ?, ?)").run(folderId, dotId, real, Date.now());
  return { id: folderId };
}

export function listFolders(dotId: string) {
  ensure();
  return db().prepare("SELECT * FROM folders WHERE dot_id = ?").all(dotId) as Array<{
    id: string;
    dot_id: string;
    path: string;
    added_at: number;
    last_scan_at: number | null;
    files: number;
    chunks: number;
    status: string;
  }>;
}

export function removeFolder(folderId: string): void {
  ensure();
  const taskId = `folder:${folderId}`;
  if (fts5Available) {
    try {
      db().prepare("DELETE FROM folder_fts WHERE folder_id = ?").run(folderId);
    } catch {}
  }
  db().prepare("DELETE FROM chunk_store WHERE task_id = ?").run(taskId);
  db().prepare("DELETE FROM folder_files WHERE folder_id = ?").run(folderId);
  db().prepare("DELETE FROM folders WHERE id = ?").run(folderId);
}

function* walk(root: string, dir = root, depth = 0): Generator<string> {
  if (depth > LIMITS.maxDepth) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // never follow links out of the folder
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(root, full, depth + 1);
    } else if (entry.isFile() && !SECRET_FILE.test(entry.name)) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXT.has(ext) || ext === ".pdf") yield full;
    }
  }
}

async function readPieces(file: string): Promise<{ text: string; page?: number }[]> {
  const buf = fs.readFileSync(file);
  if (path.extname(file).toLowerCase() === ".pdf" || isPdfBuffer(buf)) {
    const pdf = await extractPdf(buf);
    return pdf.pages.map((p) => ({ text: p.text, page: p.pageNumber }));
  }
  return [{ text: buf.toString("utf8") }];
}

function dropFile(folderId: string, rel: string) {
  const taskId = `folder:${folderId}`;
  const ids = db().prepare("SELECT id FROM chunk_store WHERE task_id = ? AND source = ?").all(taskId, rel) as { id: string }[];
  if (fts5Available) {
    try {
      const del = db().prepare("DELETE FROM folder_fts WHERE chunk_id = ?");
      for (const r of ids) del.run(r.id);
    } catch {}
  }
  db().prepare("DELETE FROM chunk_store WHERE task_id = ? AND source = ?").run(taskId, rel);
  db().prepare("DELETE FROM folder_files WHERE folder_id = ? AND rel_path = ?").run(folderId, rel);
}

/** Incremental scan: only new or changed files are re-read. Safe to call repeatedly. */
export async function scanFolder(folderId: string, onProgress?: (done: number, total: number) => void): Promise<{ files: number; chunks: number; skipped: number }> {
  ensure();
  const folder = db().prepare("SELECT * FROM folders WHERE id = ?").get(folderId) as { id: string; dot_id: string; path: string } | undefined;
  if (!folder) throw new Error("Folder not found.");
  db().prepare("UPDATE folders SET status = 'scanning' WHERE id = ?").run(folderId);
  emit({ type: "folder", dotId: folder.dot_id, folderId, status: "scanning" });

  const taskId = `folder:${folderId}`;
  const seen = new Set<string>();
  const files = [...walk(folder.path)].slice(0, LIMITS.maxFiles);
  let chunksTotal = (db().prepare("SELECT COUNT(*) AS n FROM chunk_store WHERE task_id = ?").get(taskId) as { n: number }).n;
  let skipped = 0;
  let done = 0;

  for (const file of files) {
    const rel = path.relative(folder.path, file).replace(/\\/g, "/");
    seen.add(rel);
    const st = fs.statSync(file);
    if (st.size > LIMITS.maxFileBytes || chunksTotal >= LIMITS.maxChunks) {
      skipped++;
      continue;
    }
    const prev = db().prepare("SELECT mtime, size FROM folder_files WHERE folder_id = ? AND rel_path = ?").get(folderId, rel) as { mtime: number; size: number } | undefined;
    if (prev && prev.mtime === Math.floor(st.mtimeMs) && prev.size === st.size) {
      done++;
      continue;
    }
    try {
      if (prev) dropFile(folderId, rel);
      const pieces = await readPieces(file);
      const records: ChunkRecord[] = [];
      for (const p of pieces) records.push(...chunkText({ text: p.text, source: rel, page: p.page, taskId, dotId: folder.dot_id }));
      records.forEach((r, i) => (r.position = i));
      saveChunks(records);
      if (fts5Available) {
        try {
          const ins = db().prepare("INSERT INTO folder_fts (text, chunk_id, folder_id) VALUES (?, ?, ?)");
          for (const r of records) ins.run(r.text, r.id, folderId);
        } catch {}
      }
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      db().prepare("INSERT OR REPLACE INTO folder_files (folder_id, rel_path, mtime, size, hash) VALUES (?, ?, ?, ?, ?)").run(folderId, rel, Math.floor(st.mtimeMs), st.size, hash);
      chunksTotal += records.length;
    } catch {
      skipped++;
    }
    onProgress?.(++done, files.length);
  }

  // Files that were deleted from disk.
  const known = db().prepare("SELECT rel_path FROM folder_files WHERE folder_id = ?").all(folderId) as { rel_path: string }[];
  for (const k of known) if (!seen.has(k.rel_path)) dropFile(folderId, k.rel_path);

  const fileCount = (db().prepare("SELECT COUNT(*) AS n FROM folder_files WHERE folder_id = ?").get(folderId) as { n: number }).n;
  const chunkCount = (db().prepare("SELECT COUNT(*) AS n FROM chunk_store WHERE task_id = ?").get(taskId) as { n: number }).n;
  db().prepare("UPDATE folders SET status = 'idle', last_scan_at = ?, files = ?, chunks = ? WHERE id = ?").run(Date.now(), fileCount, chunkCount, folderId);
  emit({ type: "folder", dotId: folder.dot_id, folderId, status: "idle", files: fileCount, chunks: chunkCount });

  return { files: fileCount, chunks: chunkCount, skipped };
}

const ftsQuery = (q: string) =>
  [...new Set(q.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [])]
    .slice(0, 12)
    .map((t) => `"${t}"`)
    .join(" OR ");

/** Fast first pass with FTS5 (up to 80 candidates), then the same BM25 filter and 2,500-token evidence budget as the web pipeline. */
export function searchFolder(folderId: string, query: string, maxEvidenceTokens = 2500) {
  ensure();
  if (!fts5Available) {
    const taskId = `folder:${folderId}`;
    const rows = db().prepare("SELECT * FROM chunk_store WHERE task_id = ? LIMIT 5000").all(taskId) as Record<string, unknown>[];
    const chunks: ChunkRecord[] = rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      dotId: r.dot_id as string,
      source: (r.source as string) ?? "",
      page: (r.page as number | null) ?? undefined,
      position: (r.position as number) ?? 0,
      text: r.text as string,
      contentHash: r.content_hash as string,
      status: "pending",
      createdAt: r.created_at as number,
    }));
    const res = filterChunks(query, chunks, { maxEvidenceTokens, alwaysIncludeChunk1: false });
    return { selectedChunks: res.selectedChunks, totalTokens: res.totalTokens };
  }

  const match = ftsQuery(query);
  if (!match) return { selectedChunks: [] as ChunkRecord[], totalTokens: 0 };
  const hits = db().prepare("SELECT chunk_id FROM folder_fts WHERE folder_fts MATCH ? AND folder_id = ? ORDER BY rank LIMIT 80").all(match, folderId) as { chunk_id: string }[];
  if (!hits.length) return { selectedChunks: [] as ChunkRecord[], totalTokens: 0 };
  const rows = db()
    .prepare(`SELECT * FROM chunk_store WHERE id IN (${hits.map(() => "?").join(",")})`)
    .all(...hits.map((h) => h.chunk_id)) as Record<string, unknown>[];
  const chunks: ChunkRecord[] = rows.map((r) => ({
    id: r.id as string,
    taskId: r.task_id as string,
    dotId: r.dot_id as string,
    source: (r.source as string) ?? "",
    page: (r.page as number | null) ?? undefined,
    position: (r.position as number) ?? 0,
    text: r.text as string,
    contentHash: r.content_hash as string,
    status: "pending",
    createdAt: r.created_at as number,
  }));
  const res = filterChunks(query, chunks, { maxEvidenceTokens, alwaysIncludeChunk1: false });
  return { selectedChunks: res.selectedChunks, totalTokens: res.totalTokens };
}

/** Citation check: every [[file#page]] the model wrote must point at a chunk that was actually retrieved. */
export function verifyCitations(answer: string, retrieved: ChunkRecord[]): { valid: string[]; invalid: string[] } {
  const ok = new Set(retrieved.map((c) => `${c.source}${c.page ? `#p${c.page}` : ""}`));
  // Also allow without #p<page> if file is matched
  for (const c of retrieved) {
    ok.add(c.source);
  }
  const cited = [...answer.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
  return { valid: cited.filter((c) => ok.has(c)), invalid: cited.filter((c) => !ok.has(c)) };
}

const sessionRetrieved = new Map<string, ChunkRecord[]>();

export function recordRetrieved(dotId: string, chunks: ChunkRecord[]): void {
  const list = sessionRetrieved.get(dotId) ?? [];
  list.push(...chunks);
  sessionRetrieved.set(dotId, list);
}

export function getRetrieved(dotId: string): ChunkRecord[] {
  return sessionRetrieved.get(dotId) ?? [];
}

export function clearRetrieved(dotId: string): void {
  sessionRetrieved.delete(dotId);
}

export function startFolderScanner(): void {
  ensure();
  setTimeout(async () => {
    try {
      const folders = db().prepare("SELECT id FROM folders").all() as { id: string }[];
      for (const f of folders) {
        await scanFolder(f.id).catch((err) => console.warn(`[dots] Error scanning folder ${f.id}:`, err));
      }
    } catch {}
  }, 3000);

  setInterval(async () => {
    try {
      const folders = db().prepare("SELECT id FROM folders").all() as { id: string }[];
      for (const f of folders) {
        await scanFolder(f.id).catch((err) => console.warn(`[dots] Recurring scan folder ${f.id}:`, err));
      }
    } catch {}
  }, 10 * 60 * 1000);
}
