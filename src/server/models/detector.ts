import "server-only";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { dockerAvailable } from "../computer/shell";
import { isOllamaConnected } from "../llm";
import type { CapabilityProfile } from "./types";

function command(command: string, args: string[]): string {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 3500, windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : "";
  } catch {
    return "";
  }
}

function numberFrom(value: string): number | null {
  const match = value.replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : null;
}

function hardware(): Pick<CapabilityProfile, "gpu" | "vramGB" | "diskFreeGB"> {
  if (process.platform === "win32") {
    const gpu = command("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
    if (gpu) {
      const [name, memory] = gpu.split(",").map((part) => part.trim());
      return { gpu: name || "NVIDIA GPU", vramGB: memory ? Number(memory) / 1024 : null, diskFreeGB: null };
    }
    return { gpu: null, vramGB: null, diskFreeGB: null };
  }

  if (process.platform === "darwin") {
    const profile = command("system_profiler", ["SPDisplaysDataType", "SPHardwareDataType"]);
    const gpu = profile.match(/Chipset Model:\s*(.+)/)?.[1]?.trim() ?? null;
    const memory = profile.match(/Memory:\s*([0-9.]+)\s*GB/i)?.[1];
    return { gpu, vramGB: memory ? Number(memory) : null, diskFreeGB: null };
  }

  const gpu = command("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  const [name, memory] = gpu.split(",").map((part) => part.trim());
  return { gpu: name || null, vramGB: memory ? Number(memory) / 1024 : null, diskFreeGB: null };
}

export async function detectCapabilities(): Promise<CapabilityProfile> {
  const disk = process.platform === "win32" ? command("powershell", ["-NoProfile", "-Command", "(Get-PSDrive -Name C).Free"]) : command("df", ["-k", "/"]);
  const diskFreeGB = numberFrom(disk);
  const diskGB = process.platform === "win32" ? (diskFreeGB ? diskFreeGB / 1024 ** 3 : null) : diskFreeGB ? diskFreeGB / 1024 ** 2 : null;
  return {
    os: process.platform,
    cpu: os.cpus()[0]?.model || os.arch(),
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    ...hardware(),
    diskFreeGB: diskGB ? Math.round(diskGB * 10) / 10 : null,
    ollama: await isOllamaConnected().catch(() => false),
    docker: dockerAvailable(),
  };
}
