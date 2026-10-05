import "server-only";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db";
import { runPlatformCommand } from "./platform";

export const BOX_IMAGE = process.env.DOTS_BOX_IMAGE || "node:22-bookworm";
const MAX_OUTPUT = 12_000;

let dockerChecked: { ok: boolean; at: number } | null = null;

export function dockerAvailable(): boolean {
  if (dockerChecked && Date.now() - dockerChecked.at < 30_000) return dockerChecked.ok;
  const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 });
  dockerChecked = { ok: r.status === 0, at: Date.now() };
  return dockerChecked.ok;
}

export function workspaceDir(dotId: string): string {
  const dir = path.join(DATA_DIR, "dots", dotId, "workspace");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const containerName = (dotId: string) => `dot-${dotId.replace(/[^a-z0-9_]/gi, "")}`;

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal }): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024, signal: opts.signal }, (err, stdout, stderr) => {
      let out = `${stdout ?? ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim();
      if (err && "code" in err && err.code !== undefined) out += `\n[exit ${String(err.code)}]`;
      if (err && err.name === "AbortError") out += "\n[stopped]";
      if (err && "killed" in err && err.killed) out += "\n[timed out]";
      if (out.length > MAX_OUTPUT) out = `${out.slice(0, MAX_OUTPUT / 2)}\n…[truncated]…\n${out.slice(-MAX_OUTPUT / 2)}`;
      resolve(out || "(no output)");
    });
  });
}

async function ensureContainer(dotId: string): Promise<void> {
  const name = containerName(dotId);
  const state = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name]);
  if (state.status === 0 && state.stdout.toString().trim() === "true") return;
  if (state.status === 0) {
    spawnSync("docker", ["start", name]);
    return;
  }
  await run("docker", [
    "run", "-d", "--name", name, "--hostname", "dot", "--memory", "2g", "--cpus", "2",
    "-v", `${workspaceDir(dotId)}:/workspace`, "-w", "/workspace", BOX_IMAGE, "sleep", "infinity",
  ], { timeoutMs: 180_000 });
}

/** Run a shell command on the dot's own computer (its container, or its cross-platform sandbox folder as fallback). */
export async function runOnDotComputer(dotId: string, command: string, signal?: AbortSignal): Promise<string> {
  if (dockerAvailable()) {
    await ensureContainer(dotId);
    return run("docker", ["exec", "-w", "/workspace", containerName(dotId), "bash", "-lc", command], { timeoutMs: 120_000, signal });
  }
  return runPlatformCommand(command, { cwd: workspaceDir(dotId), timeoutMs: 120_000, signal });
}

/** Run a command on the user's own machine (the computer running this app). Always gated by approvals. */
export async function runOnUserComputer(command: string, signal?: AbortSignal): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || process.cwd();
  return runPlatformCommand(command, { cwd: homeDir, timeoutMs: 120_000, signal });
}

export function resolveWorkspacePath(dotId: string, p: string): string {
  const rawRoot = workspaceDir(dotId);
  const root = fs.existsSync(rawRoot) ? fs.realpathSync(rawRoot) : path.resolve(rawRoot);
  const rel = p.replace(/^\/?workspace\/?/i, "");
  const full = path.resolve(root, rel);

  let targetPath = full;
  if (fs.existsSync(full)) {
    targetPath = fs.realpathSync(full);
  } else {
    let parent = path.dirname(full);
    let childPath = path.basename(full);
    while (parent && parent !== path.dirname(parent)) {
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        targetPath = path.join(realParent, childPath);
        break;
      }
      childPath = path.join(path.basename(parent), childPath);
      parent = path.dirname(parent);
    }
  }

  const relative = path.relative(root, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path must stay inside /workspace");
  }
  return targetPath;
}

export function resetDotComputer(dotId: string) {
  if (dockerAvailable()) spawnSync("docker", ["rm", "-f", containerName(dotId)]);
}
