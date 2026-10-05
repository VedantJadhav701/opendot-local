import "server-only";
import { db } from "../db";
import type { ChunkRecord } from "./chunker";

const INIT_CHUNK_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS chunk_store (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  dot_id       TEXT NOT NULL,
  source       TEXT,
  page         INTEGER,
  position     INTEGER,
  text         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding    BLOB,
  status       TEXT DEFAULT 'pending',
  label        TEXT,
  subquestion  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_task ON chunk_store(task_id, status);
CREATE INDEX IF NOT EXISTS idx_chunk_hash ON chunk_store(content_hash);
`;

let initialized = false;

function ensureSchema() {
  if (!initialized) {
    db().exec(INIT_CHUNK_STORE_SCHEMA);
    initialized = true;
  }
}

export function saveChunks(chunks: ChunkRecord[]): void {
  if (!chunks.length) return;
  ensureSchema();

  const stmt = db().prepare(`
    INSERT INTO chunk_store (
      id, task_id, dot_id, source, page, position, text, content_hash, status, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      text = excluded.text
  `);

  for (const c of chunks) {
    stmt.run(
      c.id,
      c.taskId,
      c.dotId,
      c.source ?? null,
      c.page ?? null,
      c.position,
      c.text,
      c.contentHash,
      c.status,
      c.createdAt
    );
  }
}

export function getTaskChunks(taskId: string): ChunkRecord[] {
  ensureSchema();
  const rows = db()
    .prepare("SELECT * FROM chunk_store WHERE task_id = ? ORDER BY position ASC")
    .all(taskId) as Array<{
    id: string;
    task_id: string;
    dot_id: string;
    source: string | null;
    page: number | null;
    position: number;
    text: string;
    content_hash: string;
    status: string;
    created_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    dotId: r.dot_id,
    source: r.source ?? "",
    page: r.page ?? undefined,
    position: r.position,
    text: r.text,
    contentHash: r.content_hash,
    status: r.status as ChunkRecord["status"],
    createdAt: r.created_at,
  }));
}

export function getDotChunks(dotId: string, limit = 100): ChunkRecord[] {
  ensureSchema();
  const rows = db()
    .prepare("SELECT * FROM chunk_store WHERE dot_id = ? ORDER BY created_at DESC, position ASC LIMIT ?")
    .all(dotId, limit) as Array<{
    id: string;
    task_id: string;
    dot_id: string;
    source: string | null;
    page: number | null;
    position: number;
    text: string;
    content_hash: string;
    status: string;
    created_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    dotId: r.dot_id,
    source: r.source ?? "",
    page: r.page ?? undefined,
    position: r.position,
    text: r.text,
    contentHash: r.content_hash,
    status: r.status as ChunkRecord["status"],
    createdAt: r.created_at,
  }));
}

export function clearTaskChunks(taskId: string): void {
  ensureSchema();
  db().prepare("DELETE FROM chunk_store WHERE task_id = ?").run(taskId);
}
