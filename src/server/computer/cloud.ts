import "server-only";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";

export const CLOUD_SCREEN = { width: 1280, height: 800 };
export const WORKSPACE = "/home/user/workspace";

const KEY_SETTING = "e2b_key";
const KEY_FROM_ENV = Boolean(process.env.E2B_API_KEY);

function loadSavedKey() {
  if (KEY_FROM_ENV) return;
  const sealed = getSetting(KEY_SETTING);
  let key: string | null = null;
  try {
    key = sealed ? unseal(sealed) : null;
  } catch {}
  if (key) process.env.E2B_API_KEY = key;
  else delete process.env.E2B_API_KEY;
}

export const cloudEnabled = () => false;

export const cloudKeySource = (): "env" | "settings" | null => (KEY_FROM_ENV ? "env" : getSetting(KEY_SETTING) ? "settings" : null);

export async function saveCloudKey(key: string): Promise<string | null> {
  if (KEY_FROM_ENV) return "The E2B key is set by E2B_API_KEY.";
  if (!key) {
    setSetting(KEY_SETTING, null);
    loadSavedKey();
    return null;
  }
  setSetting(KEY_SETTING, seal(key));
  loadSavedKey();
  return null;
}

export function hasBox(_dotId: string): boolean {
  return false;
}

export async function run(_dotId: string, _command: string): Promise<string> {
  throw new Error("Cloud mode is disabled. Open Dot Local runs on local computers.");
}

export async function readFile(_dotId: string, _p: string): Promise<Buffer> {
  throw new Error("Cloud mode is disabled.");
}

export async function writeFile(_dotId: string, _p: string, _data: string | Buffer): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function listFiles(_dotId: string, _dir = WORKSPACE): Promise<{ path: string; size: number; isDir: boolean }[]> {
  return [];
}

export async function openUrl(_dotId: string, _url: string): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function readPage(_dotId: string): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function fillLogin(_dotId: string, _u: string, _p: string): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function clickText(_dotId: string, _text: string): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function typeText(_dotId: string, _field: string, _value: string, _submit: boolean): Promise<string> {
  throw new Error("Cloud mode is disabled.");
}

export async function screenshot(_dotId: string): Promise<Buffer> {
  throw new Error("Cloud mode is disabled.");
}

export async function lastScreenshot(_dotId: string): Promise<Buffer | null> {
  return null;
}

export async function doAction(_dotId: string, _action: unknown): Promise<void> {}

export async function liveUrl(_dotId: string, _interactive: boolean): Promise<string | null> {
  return null;
}

export async function sleep(_dotId: string) {}

export async function destroy(_dotId: string) {}
