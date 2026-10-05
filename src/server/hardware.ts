import "server-only";
import os from "node:os";
import fs from "node:fs";
import execa from "child_process";

export type SystemHardwareProfile = {
  os: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cores: number;
  totalRamGB: number;
  freeRamGB: number;
  gpuName: string | null;
  vramGB: number | null;
  ollamaRunning: boolean;
  dockerAvailable: boolean;
  diskFreeGB: number | null;
};

export async function detectHardware(): Promise<SystemHardwareProfile> {
  const totalRamGB = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const freeRamGB = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || os.arch();
  const cores = cpus.length;

  let dockerAvailable = false;
  try {
    const { execSync } = require("node:child_process");
    execSync("docker info", { stdio: "ignore", timeout: 3000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }

  let ollamaRunning = false;
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    ollamaRunning = res.ok;
  } catch {
    ollamaRunning = false;
  }

  let diskFreeGB: number | null = null;
  try {
    const stat = fs.statfsSync(process.cwd());
    diskFreeGB = Math.round(((stat.bsize * stat.bfree) / 1024 ** 3) * 10) / 10;
  } catch {
    diskFreeGB = null;
  }

  return {
    os: process.platform,
    arch: os.arch(),
    cpuModel,
    cores,
    totalRamGB,
    freeRamGB,
    gpuName: null,
    vramGB: null,
    ollamaRunning,
    dockerAvailable,
    diskFreeGB,
  };
}
