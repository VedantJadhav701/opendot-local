import { runWindowsCommand } from "./windows";
import { runPosixCommand } from "./macos";

export async function runPlatformCommand(
  command: string,
  opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal }
): Promise<string> {
  if (process.platform === "win32") {
    return runWindowsCommand(command, opts);
  }
  return runPosixCommand(command, opts);
}
