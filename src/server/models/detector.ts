import "server-only";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { dockerAvailable } from "../computer/shell";
import { isOllamaConnected } from "../llm";
import type { CapabilityProfile } from "./types";

function run(command: string, args: string[], timeout = 3500): string {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout, windowsHide: true });
    return result.status === 0 ? String(result.stdout ?? "").trim() : "";
  } catch {
    return "";
  }
}

type Gpu = { gpu: string | null; vramGB: number | null; unifiedMemory: boolean };

function nvidia(): Gpu | null {
  const bins =
    process.platform === "win32"
      ? ["nvidia-smi", "C:\\Windows\\System32\\nvidia-smi.exe", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"]
      : ["nvidia-smi"];
  for (const bin of bins) {
    const out = run(bin, ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
    if (!out) continue;
    // One line per GPU. Use the one with the most memory (the conservative choice for fitting a model).
    const gpus = out
      .split(/\r?\n/)
      .map((line) => {
        const [name, mem] = line.split(",").map((part) => part.trim());
        const mb = Number(mem);
        return { name, mb: Number.isFinite(mb) && mb > 0 ? mb : 0 };
      })
      .filter((g) => g.name);
    if (!gpus.length) continue;
    const best = gpus.reduce((a, b) => (b.mb > a.mb ? b : a));
    // Grace Hopper / Blackwell GB10 report [N/A] memory because memory is unified with system RAM
    if (best.mb === 0 || best.name.toUpperCase().includes("GB10")) {
      return { gpu: best.name, vramGB: null, unifiedMemory: true };
    }
    return { gpu: best.name, vramGB: Math.round((best.mb / 1024) * 10) / 10, unifiedMemory: false };
  }
  return null;
}

function detectGpu(): Gpu {
  if (process.platform === "darwin") {
    // Apple Silicon shares memory between CPU and GPU. Intel Macs get no GPU acceleration from Ollama.
    if (process.arch === "arm64") return { gpu: os.cpus()[0]?.model ?? "Apple Silicon", vramGB: null, unifiedMemory: true };
    return { gpu: null, vramGB: null, unifiedMemory: false };
  }
  const nv = nvidia();
  if (nv) return nv;
  if (process.platform === "win32") {
    // AMD / Intel: report the name, but the reported adapter memory is unreliable, so leave VRAM unknown.
    const names = run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name -join '; '"]);
    return { gpu: names || null, vramGB: null, unifiedMemory: false };
  }
  return { gpu: null, vramGB: null, unifiedMemory: false };
}

// The GPU does not change while the app runs, and detection spawns processes, so do it once.
let gpuCache: Gpu | null = null;

function freeDiskGB(): number | null {
  try {
    const stat = fs.statfsSync(os.homedir());
    return Math.round(((Number(stat.bavail) * Number(stat.bsize)) / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

export async function detectCapabilities(): Promise<CapabilityProfile> {
  const gpu = (gpuCache ??= detectGpu());
  return {
    os: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model || os.arch(),
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpu: gpu.gpu,
    vramGB: gpu.vramGB,
    unifiedMemory: gpu.unifiedMemory,
    diskFreeGB: freeDiskGB(),
    ollama: await isOllamaConnected().catch(() => false),
    docker: dockerAvailable(),
  };
}
