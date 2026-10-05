import "server-only";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../repo";
import * as browser from "./browser";
import { BOX_IMAGE, dockerAvailable, resetDotComputer, resolveWorkspacePath, runOnDotComputer, workspaceDir } from "./shell";
import type { ComputerAction } from "./browser";

// One interface for "the dot's computer":
//   docker — a local container for the shell, a local Chromium for the browser
//   local  — a sandbox folder on this computer (commands ask first) and a local Chromium

export type ComputerMode = "docker" | "local";
export const SCREEN = { width: 1280, height: 800 };

export function defaultMode(): ComputerMode {
  const pref = process.env.DOTS_COMPUTER;
  if (pref === "docker" || pref === "local") return pref === "docker" && dockerAvailable() ? "docker" : "local";
  return dockerAvailable() ? "docker" : "local";
}

export function modeFor(dotId: string): ComputerMode {
  return defaultMode();
}

export function describe(dotId: string): string {
  const osName = process.platform === "win32" ? "Windows (PowerShell)" : process.platform === "darwin" ? "macOS (zsh)" : "Linux (bash)";
  switch (modeFor(dotId)) {
    case "docker":
      return `a Linux container (${BOX_IMAGE}) with a persistent /workspace, plus a Chromium browser`;
    default:
      return `a sandbox folder on the user's ${osName} computer (commands ask first) plus a Chromium browser`;
  }
}

// ---------- shell & files ----------

export async function runCommand(dotId: string, command: string, signal?: AbortSignal): Promise<string> {
  return runOnDotComputer(dotId, command, signal);
}

export async function readFile(dotId: string, p: string): Promise<Buffer> {
  return fs.promises.readFile(resolveWorkspacePath(dotId, p));
}

export async function writeFile(dotId: string, p: string, data: string | Buffer): Promise<string> {
  const full = resolveWorkspacePath(dotId, p);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  return `/workspace/${path.relative(workspaceDir(dotId), full)}`;
}

export type FileEntry = { path: string; size: number; isDir: boolean };

export async function listFiles(dotId: string): Promise<FileEntry[]> {
  const root = workspaceDir(dotId);
  const out: FileEntry[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || out.length >= 500) continue;
      const full = path.join(dir, e.name);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({ path: path.relative(root, full), size: stat.size, isDir: e.isDirectory() });
      if (e.isDirectory() && depth < 3) await walk(full, depth + 1);
    }
  };
  await walk(root, 1);
  return out;
}

// ---------- browser & screen ----------

export const openUrl = (dotId: string, url: string) => browser.openUrl(dotId, url);
export const readPage = (dotId: string) => browser.readPage(dotId);
export const fillLogin = (dotId: string, u: string, p: string) => browser.fillLogin(dotId, u, p);
export const clickText = (dotId: string, text: string) => browser.clickText(dotId, text);
export const typeText = (dotId: string, field: string, value: string, submit: boolean) => browser.typeText(dotId, field, value, submit);
export const doAction = (dotId: string, a: ComputerAction) => browser.doAction(dotId, a);
export const screenshot = (dotId: string) => browser.screenshot(dotId);
export const lastScreenshot = (dotId: string) => browser.lastScreenshot(dotId);

export async function liveUrl(_dotId: string, _interactive: boolean): Promise<string | null> {
  return null;
}

export async function takeOver(dotId: string): Promise<string | null> {
  await browser.wake(dotId);
  return null;
}

export async function wake(dotId: string) {
  await browser.wake(dotId);
}

export async function handBack(dotId: string) {
  await browser.handBack(dotId);
}

// Live view of the local browser.
export const streamScreen = browser.stream;
export const userInput = browser.input;
export type { UserInput } from "./browser";

// ---------- lifecycle ----------

export async function sleep(_dotId: string) {}

export async function reset(dotId: string) {
  await browser.closeBrowser(dotId);
  resetDotComputer(dotId);
}

export async function destroy(dotId: string) {
  resetDotComputer(dotId);
  await browser.deleteData(dotId).catch(() => {});
  repo.setBoxId(dotId, null);
}
