import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import * as repo from "../src/server/repo";
import { sendMessage } from "../src/server/agent/runtime";
import { startBenchmarkServer } from "./server";
import { score, wilson, harnessError, intervalsOverlap, type Expect } from "./score";

type Question = { id: number; category: string; bucket: string; fixture: string; question: string; expect: Expect };

type RunResult = {
  condition: string;
  qid: number;
  category: string;
  bucket: string;
  run: number;
  pass: boolean;
  why: string[];
  invalid: string | null; // harness error that survived all retries
  attempts: number;
  steps: number;
  wallMs: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  peakVramMB: number | null;
  webAttempts: string[]; // hosts the agent tried to reach; all were blocked
  answer: string;
};

const CONDITIONS = ["off-short", "off-long", "on"] as const;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const OUT_DIR = path.join(__dirname, "fixtures", "out");
const RES_DIR = path.join(__dirname, "results");

// ---------- network guard + Ollama token counting ----------
// Benchmarks must not touch the real web (the first run let the model search "Kestrel Dock 9" and
// "api.harbor.gg"). Only loopback is allowed; every other attempt is blocked and recorded.
const meter = { prompt: 0, completion: 0, blocked: [] as string[] };

function installNetworkGuard() {
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url: string = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let u: URL | null = null;
    try { u = new URL(url); } catch { /* relative or invalid: let it through */ }
    if (u && !LOCAL_HOSTS.has(u.hostname)) {
      meter.blocked.push(u.hostname);
      throw new Error(`bench: network blocked (${u.hostname})`);
    }
    const res = await realFetch(input, init);
    if (u && /\/api\/(chat|generate)$/.test(u.pathname)) {
      res.clone().text().then((body) => {
        for (const line of body.split("\n")) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            if (typeof o.prompt_eval_count === "number") meter.prompt += o.prompt_eval_count;
            if (typeof o.eval_count === "number") meter.completion += o.eval_count;
          } catch { /* partial line */ }
        }
      }).catch(() => {});
    }
    return res;
  };
}

// ---------- helpers ----------
function gpuMemMB(): number | null {
  try {
    const out = execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vals = out.trim().split("\n").map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n));
    return vals.length ? Math.max(...vals) : null;
  } catch { return null; }
}

const stripHtml = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const fixtureText = (f: string) => {
  const txt = path.join(OUT_DIR, f.replace(/\.html$/, ".txt"));
  return fs.existsSync(txt) ? fs.readFileSync(txt, "utf8") : stripHtml(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
};

/** Refuse to run if the fixtures cannot possibly answer the questions, or the engine switch is not wired. */
function preflight(questions: Question[]) {
  const problems: string[] = [];
  if (!fs.existsSync(path.join(OUT_DIR, "manifest.json"))) problems.push("fixtures not built: run `npx tsx bench/fixtures/build.ts` first");
  else {
    for (const q of questions) {
      const text = q.fixture.split(",").map((f) => fixtureText(f.trim())).join("\n");
      if (q.bucket === "none") {
        if (/budget/i.test(text)) problems.push(`Q${q.id}: unanswerable question but the page mentions 'budget'`);
        continue;
      }
      const r = score(text, { all: q.expect.all, any: q.expect.any });
      if (!r.pass) problems.push(`Q${q.id}: the fixture does not contain its own answer (${r.why.join("; ")})`);
    }
  }
  // The mode switch must exist somewhere in the app, otherwise "on" and "off" are the same code.
  const srcDir = path.join(__dirname, "..", "src");
  let wired = false;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && fs.readFileSync(p, "utf8").includes("DOTS_CONTEXT_ENGINE")) wired = true;
    }
  };
  try { walk(srcDir); } catch { /* ignore */ }
  if (!wired) problems.push("DOTS_CONTEXT_ENGINE is not read anywhere in src/. The 'on' and 'off' conditions would run identical code.");
  if (problems.length) {
    console.error("\nPREFLIGHT FAILED:\n" + problems.map((p) => " - " + p).join("\n"));
    process.exit(1);
  }
}

async function warmUp(model: string) {
  try {
    await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "ok", stream: false, keep_alive: "30m", options: { num_predict: 1 } }),
    });
  } catch (e) {
    console.warn("warm-up failed (is Ollama running?):", (e as Error).message);
  }
}

/** Sends one message and waits until the dot is idle again. Returns elapsed ms, timeout flag and peak VRAM. */
async function runTurn(dotId: string, text: string, conversationId: string, maxMs = 240000) {
  sendMessage(dotId, text, [], conversationId);
  const start = Date.now();
  let sawWorking = false;
  let peak = gpuMemMB() ?? 0;
  let lastVram = start;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 500));
    if (Date.now() - lastVram > 2500) { peak = Math.max(peak, gpuMemMB() ?? 0); lastVram = Date.now(); }
    const d = repo.getDot(dotId);
    if (!d) continue;
    if (d.status === "working") sawWorking = true;
    const answered = repo.conversationMessages(conversationId).some((m) => m.role === "dot");
    if (d.status === "idle" && (sawWorking || (answered && Date.now() - start > 8000))) {
      return { ms: Date.now() - start, timedOut: false, peak: peak || null };
    }
  }
  return { ms: Date.now() - start, timedOut: true, peak: peak || null };
}

async function runOnce(cond: string, q: Question, r: number, model: string, maxRetries: number): Promise<RunResult> {
  const { DEFAULT_LOOK } = await import("../src/lib/look");
  let attempt = 0;
  for (;;) {
    attempt++;
    process.env.DOTS_CONTEXT_ENGINE = cond;
    meter.prompt = 0; meter.completion = 0; meter.blocked = [];
    const dot = repo.createDot({ name: `Bench_${cond}_q${q.id}_r${r}_a${attempt}`, purpose: "Benchmark Agent", look: DEFAULT_LOOK });
    try {
      repo.updateDot(dot.id, { model });
      const conv = repo.createConversation(dot.id, `Bench Q${q.id}`);
      const t = await runTurn(dot.id, q.question, conv.id);
      await new Promise((res) => setTimeout(res, 400)); // let token accounting finish
      const msgs = repo.conversationMessages(conv.id);
      const dotMsgs = msgs.filter((m) => m.role === "dot");
      const answer = dotMsgs[dotMsgs.length - 1]?.text || "";
      const err = harnessError(answer, t.timedOut);
      if (err && attempt <= maxRetries) {
        console.log(`  [retry] Q${q.id} ${cond} run ${r}: ${err} (attempt ${attempt})`);
        continue;
      }
      const scored = score(answer, q.expect);
      return {
        condition: cond, qid: q.id, category: q.category, bucket: q.bucket, run: r,
        pass: !err && scored.pass, why: err ? [`harness: ${err}`] : scored.why, invalid: err, attempts: attempt,
        steps: dotMsgs.length, wallMs: t.ms, promptTokens: meter.prompt, completionTokens: meter.completion,
        toolCalls: msgs.filter((m) => m.role === "activity").length, peakVramMB: t.peak,
        webAttempts: [...meter.blocked], answer,
      };
    } finally {
      repo.deleteDot(dot.id);
    }
  }
}

/** Dump the full conversation for one question per condition, so you can see what the model was actually given. */
async function diagnose(q: Question, model: string) {
  const { DEFAULT_LOOK } = await import("../src/lib/look");
  fs.mkdirSync(RES_DIR, { recursive: true });
  for (const cond of CONDITIONS) {
    process.env.DOTS_CONTEXT_ENGINE = cond;
    const dot = repo.createDot({ name: `Diag_${cond}`, purpose: "Benchmark Agent", look: DEFAULT_LOOK });
    try {
      repo.updateDot(dot.id, { model });
      const conv = repo.createConversation(dot.id, `Diag Q${q.id}`);
      const t = await runTurn(dot.id, q.question, conv.id);
      const msgs = repo.conversationMessages(conv.id).map((m) => ({ role: m.role, chars: (m.text || "").length, text: (m.text || "").slice(0, 1500) }));
      const file = path.join(RES_DIR, `diag-${cond}-q${q.id}.json`);
      fs.writeFileSync(file, JSON.stringify({ condition: cond, env: process.env.DOTS_CONTEXT_ENGINE, timedOut: t.timedOut, ms: t.ms, tokens: { prompt: meter.prompt, completion: meter.completion }, blockedHosts: meter.blocked, msgs }, null, 2));
      console.log(`[diag] ${cond}: ${msgs.length} messages, ${meter.prompt} prompt tokens -> ${file}`);
      meter.prompt = 0; meter.completion = 0; meter.blocked = [];
    } finally {
      repo.deleteDot(dot.id);
    }
  }
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function report(all: RunResult[], model: string, runsCount: number): string {
  let md = `# OpenDot-local Context Engine Benchmark Results\n\n**Date**: ${new Date().toISOString()}  \n**Model**: \`${model}\`  \n**Runs per question**: ${runsCount}  \n\n`;
  md += `## Overall\n\n| Condition | Pass rate | 95% Wilson interval | Median steps | Median wall (s) | Median prompt tokens | Invalid runs | Blocked web attempts |\n|---|---|---|---|---|---|---|---|\n`;
  const iv: Record<string, [number, number]> = {};
  for (const c of CONDITIONS) {
    const l = all.filter((r) => r.condition === c);
    const p = l.filter((r) => r.pass).length;
    iv[c] = wilson(p, l.length);
    md += `| \`${c}\` | ${pct(l.length ? p / l.length : 0)} (${p}/${l.length}) | [${pct(iv[c][0])}, ${pct(iv[c][1])}] | ${median(l.map((r) => r.steps))} | ${(median(l.map((r) => r.wallMs)) / 1000).toFixed(1)} | ${median(l.map((r) => r.promptTokens))} | ${l.filter((r) => r.invalid).length} | ${l.filter((r) => r.webAttempts.length).length} |\n`;
  }
  md += `\n`;
  const cmp = (a: string, b: string) => {
    const pa = all.filter((r) => r.condition === a && r.pass).length / Math.max(1, all.filter((r) => r.condition === a).length);
    const pb = all.filter((r) => r.condition === b && r.pass).length / Math.max(1, all.filter((r) => r.condition === b).length);
    return intervalsOverlap(iv[a], iv[b])
      ? `- \`${a}\` vs \`${b}\`: intervals overlap. **No difference can be claimed.**`
      : `- \`${a}\` vs \`${b}\`: intervals do not overlap. \`${pa > pb ? a : b}\` is higher.`;
  };
  md += `### Verdict\n\n${cmp("on", "off-short")}\n${cmp("on", "off-long")}\n${cmp("off-long", "off-short")}\n\n`;
  md += `Note: runs of the same question are not independent, so these intervals are, if anything, too narrow. Treat borderline gaps as inconclusive.\n\n`;

  const bucketOrder = ["short", "early", "mid", "split", "deep", "none"];
  md += `## By where the answer sits in the page\n\nearly = inside the 4,000-char clip; mid = between 4,000 and 12,000; deep = beyond 12,000; split = two facts far apart; short = tiny pages; none = unanswerable.\n\n| Bucket | Questions | ${CONDITIONS.map((c) => `\`${c}\``).join(" | ")} |\n|---|---|${CONDITIONS.map(() => "---").join("|")}|\n`;
  for (const b of bucketOrder) {
    const rows = all.filter((r) => r.bucket === b);
    if (!rows.length) continue;
    const nq = new Set(rows.map((r) => r.qid)).size;
    md += `| ${b} | ${nq} | ${CONDITIONS.map((c) => { const l = rows.filter((r) => r.condition === c); const p = l.filter((r) => r.pass).length; return `${p}/${l.length}`; }).join(" | ")} |\n`;
  }
  md += `\n## By category\n\n| Category | ${CONDITIONS.map((c) => `\`${c}\``).join(" | ")} |\n|---|${CONDITIONS.map(() => "---").join("|")}|\n`;
  for (const cat of [...new Set(all.map((r) => r.category))]) {
    md += `| ${cat} | ${CONDITIONS.map((c) => { const l = all.filter((r) => r.category === cat && r.condition === c); return `${l.filter((r) => r.pass).length}/${l.length}`; }).join(" | ")} |\n`;
  }
  const zeroTok = all.every((r) => r.promptTokens === 0);
  if (zeroTok) md += `\n> Token counts are all 0: Ollama usage was not captured (the app may not use global fetch for chat). Do not publish token numbers.\n`;
  const invalid = all.filter((r) => r.invalid);
  if (invalid.length) md += `\n> ${invalid.length} run(s) still had a harness error after retries and are counted as failures: ${invalid.map((r) => `Q${r.qid}/${r.condition}`).join(", ")}.\n`;
  return md;
}

export async function runBenchmark() {
  const args = process.argv.slice(2);
  let runsCount = 3;
  let onlyQids: number[] | null = null;
  let model = "qwen3:4b-instruct-2507-q4_K_M";
  let maxRetries = 2;
  let diag = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--runs" && args[i + 1]) { runsCount = parseInt(args[++i], 10) || 3; }
    else if (args[i] === "--only" && args[i + 1]) { onlyQids = args[++i].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean); }
    else if (args[i] === "--model" && args[i + 1]) { model = args[++i]; }
    else if (args[i] === "--retries" && args[i + 1]) { maxRetries = parseInt(args[++i], 10) || 0; }
    else if (args[i] === "--diag") { diag = true; }
  }

  process.env.DOTS_BENCH = "1";
  const allQuestions: Question[] = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
  const questions = onlyQids ? allQuestions.filter((q) => onlyQids!.includes(q.id)) : allQuestions;

  preflight(questions);
  installNetworkGuard();
  console.log("Starting benchmark fixture server...");
  const server = await startBenchmarkServer();
  console.log(`Warming up ${model}...`);
  await warmUp(model);

  try {
    if (diag) {
      await diagnose(questions[0], model);
      return;
    }

    const all: RunResult[] = [];
    console.log(`Running ${questions.length} questions x ${CONDITIONS.length} conditions x ${runsCount} run(s). Conditions are interleaved so drift hits all three equally.`);
    for (const q of questions) {
      for (let r = 1; r <= runsCount; r++) {
        const k = (q.id + r) % CONDITIONS.length;
        const order = [...CONDITIONS.slice(k), ...CONDITIONS.slice(0, k)];
        for (const cond of order) {
          const res = await runOnce(cond, q, r, model, maxRetries);
          all.push(res);
          console.log(`[${cond}] Q${q.id} run ${r}: ${res.pass ? "PASS" : "FAIL"} (${(res.wallMs / 1000).toFixed(1)}s, ${res.promptTokens} prompt tok${res.webAttempts.length ? `, blocked web: ${res.webAttempts.join(",")}` : ""})${res.pass ? "" : " -> " + res.why.join("; ")}`);
        }
      }
    }

    fs.mkdirSync(RES_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const rawFile = path.join(RES_DIR, `${dateStr}-benchmark.json`);
    fs.writeFileSync(rawFile, JSON.stringify(all, null, 2), "utf8");
    fs.writeFileSync(path.join(RES_DIR, "latest.md"), report(all, model, runsCount), "utf8");
    console.log(`\nResults written to bench/results/latest.md and ${rawFile}`);
  } finally {
    server.close();
    delete process.env.DOTS_BENCH;
  }
}

if (require.main === module) {
  runBenchmark().then(() => process.exit(0)).catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
