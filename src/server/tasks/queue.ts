import "server-only";
import { db } from "../db";

export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting"
  | "approval"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

export type PersistentTask = {
  id: string;
  dotId: string;
  conversationId?: string;
  status: TaskStatus;
  priority: number;
  request: string;
  plan?: string;
  currentStep: number;
  selectedModel?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export function enqueueTask(req: {
  dotId: string;
  request: string;
  conversationId?: string;
  priority?: number;
  selectedModel?: string;
}): PersistentTask {
  const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const task: PersistentTask = {
    id,
    dotId: req.dotId,
    conversationId: req.conversationId,
    status: "queued",
    priority: req.priority ?? 0,
    request: req.request,
    currentStep: 0,
    selectedModel: req.selectedModel,
    createdAt: now,
    updatedAt: now,
  };

  db().prepare(`
    INSERT INTO task_queue (id, dot_id, conversation_id, status, priority, request, current_step, selected_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.dotId,
    task.conversationId ?? null,
    task.status,
    task.priority,
    task.request,
    task.currentStep,
    task.selectedModel ?? null,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

export function updateTaskStatus(id: string, status: TaskStatus, details?: { plan?: string; currentStep?: number; error?: string }): void {
  const now = Date.now();
  const completedAt = status === "completed" || status === "failed" || status === "cancelled" ? now : null;

  db().prepare(`
    UPDATE task_queue
    SET status = ?,
        plan = COALESCE(?, plan),
        current_step = COALESCE(?, current_step),
        error = COALESCE(?, error),
        updated_at = ?,
        completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(
    status,
    details?.plan ?? null,
    details?.currentStep ?? null,
    details?.error ?? null,
    now,
    completedAt,
    id
  );
}

export function getPendingTasks(dotId?: string): PersistentTask[] {
  const query = dotId
    ? "SELECT * FROM task_queue WHERE dot_id = ? AND status IN ('queued', 'planning', 'running', 'waiting', 'approval', 'paused') ORDER BY priority DESC, created_at ASC"
    : "SELECT * FROM task_queue WHERE status IN ('queued', 'planning', 'running', 'waiting', 'approval', 'paused') ORDER BY priority DESC, created_at ASC";

  const rows = (dotId ? db().prepare(query).all(dotId) : db().prepare(query).all()) as Array<{
    id: string;
    dot_id: string;
    conversation_id: string | null;
    status: string;
    priority: number;
    request: string;
    plan: string | null;
    current_step: number;
    selected_model: string | null;
    error: string | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    dotId: r.dot_id,
    conversationId: r.conversation_id ?? undefined,
    status: r.status as TaskStatus,
    priority: r.priority,
    request: r.request,
    plan: r.plan ?? undefined,
    currentStep: r.current_step,
    selectedModel: r.selected_model ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at ?? undefined,
  }));
}

export function recoverInterruptedTasks(): void {
  // Turn any tasks left as "running" or "planning" from a previous crashed run into "queued" so they resume cleanly
  db().prepare(`
    UPDATE task_queue
    SET status = 'queued', updated_at = ?
    WHERE status IN ('running', 'planning')
  `).run(Date.now());
}
