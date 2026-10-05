import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

async function runCapture() {
  console.log("=== Triggering inference request on qwen3:4b-instruct-2507 ===");

  const requestBody = JSON.stringify({
    model: "qwen3:4b-instruct-2507",
    stream: true,
    think: false,
    options: {
      num_ctx: 4096,
      num_predict: 600,
    },
    messages: [
      { role: "user", content: "Write a 500 word detailed essay on space exploration and future astrophysics missions." },
    ],
  });

  const req = http.request("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestBody),
    },
  });

  req.write(requestBody);
  req.end();

  // Polling loop to capture ollama ps output while model is loaded in VRAM
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const psOutput = execSync("ollama ps", { encoding: "utf8" });
      if (psOutput.includes("qwen3:4b-instruct-2507")) {
        console.log("--- RAW OLLAMA PS OUTPUT DURING GENERATION ---");
        console.log(psOutput);
        console.log("----------------------------------------------");

        const outDir = path.join(process.cwd(), "docs", "raw");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "ollama-ps-item0.txt"), psOutput);
        console.log("Saved raw output to docs/raw/ollama-ps-item0.txt");
        break;
      }
    } catch {}
  }
}

runCapture().catch(console.error);
