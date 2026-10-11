import "server-only";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { isOllamaConnected, listAvailableModels } from "./llm/registry";
import { db, DATA_DIR } from "./db";

export type HealthStatus = {
  ollama: { ok: boolean; models: string[]; error?: string };
  database: { ok: boolean; path: string; error?: string };
  workspace: { ok: boolean; path: string; error?: string };
  browser: { ok: boolean; channel: string; executablePath?: string; error?: string };
};

export async function checkSystemHealth(): Promise<HealthStatus> {
  // 1. Ollama Health
  let ollamaOk = false;
  let models: string[] = [];
  let ollamaError: string | undefined;
  try {
    ollamaOk = await isOllamaConnected();
    if (ollamaOk) {
      const list = await listAvailableModels();
      models = list.map((m) => m.id);
    } else {
      ollamaError = "Cannot connect to Ollama at http://127.0.0.1:11434. Ensure Ollama service is running.";
    }
  } catch (err: any) {
    ollamaError = `Ollama health check error: ${err.message}`;
  }

  // 2. Database Health
  let dbOk = false;
  let dbError: string | undefined;
  const dbPath = path.join(DATA_DIR, "dots.db");
  try {
    const res = db().prepare("SELECT 1 as test").get() as { test?: number };
    dbOk = res?.test === 1;
  } catch (err: any) {
    dbError = `Database error: ${err.message}`;
  }

  // 3. Workspace Health
  let wsOk = false;
  let wsError: string | undefined;
  const wsPath = path.join(DATA_DIR, "workspace");
  try {
    fs.mkdirSync(wsPath, { recursive: true });
    wsOk = fs.existsSync(wsPath);
  } catch (err: any) {
    wsError = `Workspace error: ${err.message}`;
  }

  // 4. Browser / Playwright Chromium Health
  let browserOk = false;
  let execPath: string | undefined;
  let browserError: string | undefined;
  let channel = "chromium";

  // Check system installed browser candidates (Edge, Chrome)
  const candidateChannels = process.platform === "win32" ? ["msedge", "chrome"] : ["chrome"];
  for (const ch of candidateChannels) {
    try {
      const p = (chromium as unknown as { executablePath(opts?: { channel?: string }): string }).executablePath({ channel: ch });
      if (p && fs.existsSync(p)) {
        browserOk = true;
        channel = ch;
        execPath = p;
        break;
      }
    } catch {}
  }

  if (!browserOk) {
    try {
      execPath = chromium.executablePath();
      if (execPath && fs.existsSync(execPath)) {
        browserOk = true;
        channel = "chromium";
      } else {
        browserError = `No browser found (Edge, Chrome, or Chromium). Click 'Install browser engine' to download Chromium.`;
      }
    } catch (err: any) {
      browserError = `No browser found: ${err.message}. Click 'Install browser engine' to download Chromium.`;
    }
  }

  return {
    ollama: { ok: ollamaOk, models, error: ollamaError },
    database: { ok: dbOk, path: dbPath, error: dbError },
    workspace: { ok: wsOk, path: wsPath, error: wsError },
    browser: { ok: browserOk, channel, executablePath: execPath, error: browserError },
  };
}
