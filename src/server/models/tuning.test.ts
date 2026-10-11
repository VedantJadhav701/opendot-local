import { resolveTuning } from "./tuning";
import type { CapabilityProfile } from "./types";

console.log("=== Testing Phase D Hardware Auto-Tuning ===");

// 1. 4 GB laptop GPU with 4B model -> Balanced (8k)
const profile4GB: CapabilityProfile = {
  os: "Windows",
  cpu: "Intel i5",
  ramGB: 16,
  gpu: "RTX 3050",
  vramGB: 4.0,
  unifiedMemory: false,
  docker: false,
  diskFreeGB: 50,
};
const t1 = resolveTuning(profile4GB, "qwen3:4b-instruct-2507-q4_K_M", "auto");
if (t1.mode !== "balanced" || t1.numCtx !== 8192) {
  throw new Error(`Test 1 Failed: expected balanced/8192, got ${t1.mode}/${t1.numCtx}`);
}
console.log(`PASS: 4 GB card -> ${t1.mode} (${t1.numCtx} ctx). Reason: ${t1.reason}`);

// 2. 8 GB dedicated GPU with 4B model -> Quality (16k)
const profile8GB: CapabilityProfile = {
  os: "Windows",
  cpu: "Ryzen 7",
  ramGB: 32,
  gpu: "RTX 3070",
  vramGB: 8.0,
  unifiedMemory: false,
  docker: false,
  diskFreeGB: 100,
};
const t2 = resolveTuning(profile8GB, "qwen3:4b-instruct-2507-q4_K_M", "auto");
if (t2.mode !== "quality" || t2.numCtx !== 16384) {
  throw new Error(`Test 2 Failed: expected quality/16384, got ${t2.mode}/${t2.numCtx}`);
}
console.log(`PASS: 8 GB card -> ${t2.mode} (${t2.numCtx} ctx). Reason: ${t2.reason}`);

// 3. CPU only machine with 8 GB RAM -> Fast (4k)
const profileCPU: CapabilityProfile = {
  os: "Linux",
  cpu: "Intel i3",
  ramGB: 8,
  gpu: null,
  vramGB: null,
  unifiedMemory: false,
  docker: false,
  diskFreeGB: 20,
};
const t3 = resolveTuning(profileCPU, "qwen3:4b-instruct-2507-q4_K_M", "auto");
if (t3.mode !== "fast" || t3.numCtx !== 4096) {
  throw new Error(`Test 3 Failed: expected fast/4096, got ${t3.mode}/${t3.numCtx}`);
}
console.log(`PASS: CPU only (8GB RAM) -> ${t3.mode} (${t3.numCtx} ctx). Reason: ${t3.reason}`);

// 4. Apple Silicon 16 GB Unified Memory -> Quality (16k)
const profileApple: CapabilityProfile = {
  os: "macOS",
  cpu: "Apple M2",
  ramGB: 16,
  gpu: "Apple M2",
  vramGB: null,
  unifiedMemory: true,
  docker: false,
  diskFreeGB: 120,
};
const t4 = resolveTuning(profileApple, "qwen3:4b-instruct-2507-q4_K_M", "auto");
if (t4.mode !== "quality" || t4.numCtx !== 16384) {
  throw new Error(`Test 4 Failed: expected quality/16384, got ${t4.mode}/${t4.numCtx}`);
}
console.log(`PASS: Apple Silicon 16GB -> ${t4.mode} (${t4.numCtx} ctx). Reason: ${t4.reason}`);

// 5. Manual override to Fast
const t5 = resolveTuning(profile8GB, "qwen3:4b-instruct-2507-q4_K_M", "fast");
if (t5.mode !== "fast" || t5.numCtx !== 4096) {
  throw new Error(`Test 5 Failed: override to fast failed: ${t5.mode}`);
}
console.log(`PASS: Manual override -> ${t5.mode} (${t5.numCtx} ctx).`);

console.log("All Phase D Hardware Auto-Tuning Unit Tests PASSED!");
