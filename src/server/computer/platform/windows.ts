import { execFile } from "node:child_process";

const MAX_OUTPUT = 12_000;

export async function runWindowsCommand(
  command: string,
  opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal }
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        let out = `${stdout ?? ""}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim();
        if (err && "code" in err && err.code !== undefined) out += `\n[exit ${String(err.code)}]`;
        if (err && err.name === "AbortError") out += "\n[stopped]";
        if (err && "killed" in err && err.killed) out += "\n[timed out]";
        if (out.length > MAX_OUTPUT) {
          out = `${out.slice(0, MAX_OUTPUT / 2)}\n…[truncated]…\n${out.slice(-MAX_OUTPUT / 2)}`;
        }
        resolve(out || "(no output)");
      }
    );
  });
}
