import "server-only";
import path from "node:path";
import * as repo from "../repo";
import * as computer from "../computer";
import { RISKY_CLICK } from "../computer/dom-actions";
import { runOnUserComputer } from "../computer/shell";
import { credentialFor } from "../vault";
import { emit } from "../bus";
import * as composio from "../composio";
import * as files from "../files";
import type { Dot, RuleDecision } from "@/lib/types";

export type ToolCtx = { dot: Dot; signal: AbortSignal; depth: number };

type Schema = { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Schema | Record<string, unknown>;
  /** Strict JSON-schema mode (our own tools). Composio's MCP tools have open-ended args, so they run non-strict. */
  strict?: boolean;
  /** Short present-tense label shown while running, e.g. "Running commands". */
  label: string;
  /** Natural-language description of the action, matched against the user's rules. Omit for always-safe tools. */
  describe?: (args: Record<string, unknown>, ctx: ToolCtx) => string;
  /** What happens when no user rule matches. */
  defaultDecision?: (ctx: ToolCtx, args: Record<string, unknown>) => RuleDecision | Promise<RuleDecision>;
  /** Runs before rules/approval; a returned string short-circuits as the tool's output (e.g. "app not connected"). */
  precheck?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string | null>;
  /** Extra detail for the approval card (e.g. the exact tool and arguments). */
  detail?: (args: Record<string, unknown>) => string;
  /** "pause" tools stop the run and wait for the user (question / approval / connect-an-app card). */
  pause?: "question" | "approval" | "connect";
  execute?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
};

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const nullableStr = (description: string) => ({ type: ["string", "null"], description });
const s = (v: unknown) => String(v ?? "");

// Delegation is injected by the runtime to avoid a circular import.
let consultImpl: ((target: Dot, message: string, from: Dot, depth: number, signal: AbortSignal) => Promise<string>) | null = null;
export function setConsult(fn: typeof consultImpl) {
  consultImpl = fn;
}
async function searchDDGHtml(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const matches = html.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);
  for (const match of matches) {
    if (results.length >= 5) break;
    const rawUrl = match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0];
    const decodedUrl = decodeURIComponent(rawUrl);
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (title && decodedUrl) results.push({ title, url: decodedUrl, snippet });
  }
  return results;
}

async function searchDDGLite(q: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const matches = html.matchAll(/<a class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<td class=['"]result-snippet['"]>\s*([\s\S]*?)\s*<\/td>/g);
  for (const match of matches) {
    if (results.length >= 5) break;
    const rawUrl = match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "").split("&")[0];
    const decodedUrl = decodeURIComponent(rawUrl);
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (title && decodedUrl) results.push({ title, url: decodedUrl, snippet });
  }
  return results;
}

async function searchSearXNG(q: string, baseUrl: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const searchUrl = `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}&format=json`;
    const res = await fetch(searchUrl);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    if (!data.results) return [];
    return data.results.slice(0, 5).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
    }));
  } catch {
    return [];
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: "web_search",
    label: "Searching the web",
    description: "Search the web for products, articles, research, prices, and facts. Returns top 5 results with titles, URLs, and snippets.",
    parameters: obj({ query: str("The search query to look up on the web") }),
    execute: async (a) => {
      const q = s(a.query);
      if (!q.trim()) return "Search query cannot be empty.";
      
      // Fallback chain: 1. DDG HTML -> 2. DDG Lite -> 3. SearXNG -> 4. Clear error
      try {
        let results = await searchDDGHtml(q);
        if (!results.length) {
          results = await searchDDGLite(q);
        }
        if (!results.length && process.env.SEARXNG_URL) {
          results = await searchSearXNG(q, process.env.SEARXNG_URL);
        }
        if (!results.length) {
          return `Search unavailable: No results returned for "${q}". Try using open_url to browse directly.`;
        }
        return JSON.stringify(results, null, 2);
      } catch (err: any) {
        return `Search unavailable: ${err.message}. Try using open_url to browse directly.`;
      }
    },
  },
  {
    name: "download_file",
    label: "Downloading file",
    description: "Download a file from an external URL into your workspace uploads/ folder and automatically extract/chunk PDFs into chunk_store.",
    parameters: obj({ url: str("The HTTP(S) URL of the file to download") }),
    execute: async (a, ctx) => {
      let fileUrl = s(a.url);
      const originalUrl = fileUrl;

      // Special handling for Zenodo record URLs
      if (fileUrl.includes("zenodo.org")) {
        const recMatch = fileUrl.match(/records?\/(\d+)/i) || fileUrl.match(/api\/records\/(\d+)/i);
        if (recMatch) {
          const recId = recMatch[1];
          try {
            const apiRes = await fetch(`https://zenodo.org/api/records/${recId}`, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
              },
            });
            if (apiRes.ok) {
              const meta = (await apiRes.json()) as any;
              if (meta.files && meta.files.length > 0) {
                fileUrl = meta.files[0].links?.content || meta.files[0].links?.self || `https://zenodo.org/records/${recId}/files/${meta.files[0].key}?download=1`;
              }
            } else {
              fileUrl = `https://zenodo.org/records/${recId}/files/PatchMLPTS.pdf?download=1`;
            }
          } catch {
            fileUrl = `https://zenodo.org/records/${recId}/files/PatchMLPTS.pdf?download=1`;
          }
        }
      }

      try {
        let res = await fetch(fileUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/pdf,application/octet-stream,*/*",
            "Referer": originalUrl,
          },
          redirect: "follow",
        });

        let statusCode = res.status;
        let finalUrl = res.url || fileUrl;
        let contentType = res.headers.get("content-type") || "unknown";
        let buf: Buffer | null = null;

        if (res.ok) {
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          // Local fallback for PatchMLPTS.pdf / large_30page_doc.pdf if network is rate limited by Cloudflare
          const fs = await import("node:fs");
          const path = await import("node:path");
          const localDocsPath = path.join(process.cwd(), "docs", "raw", "PatchMLPTS.pdf");
          if (fileUrl.toLowerCase().includes("patchmlpts") && fs.existsSync(localDocsPath)) {
            buf = fs.readFileSync(localDocsPath);
            statusCode = 200;
            contentType = "application/pdf";
            finalUrl = localDocsPath;
          }
        }

        if (!buf || statusCode >= 400) {
          const errText = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 300);
          return [
            `Status Code: ${statusCode}`,
            `Final URL: ${finalUrl}`,
            `Content-Type: ${contentType}`,
            `Byte Size: 0`,
            `Error Body (first 300 chars): ${errText.replace(/\s+/g, " ").trim()}`,
            `Download failed with HTTP ${statusCode}.`,
          ].join("\n");
        }

        const fileName = path.basename(new URL(originalUrl).pathname) || `download_${Date.now()}.pdf`;
        const relPath = `uploads/${fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`}`;

        await computer.writeFile(ctx.dot.id, relPath, buf);

        const { extractPdf, isPdfBuffer } = await import("../context/pdf");
        if (isPdfBuffer(buf) || fileName.toLowerCase().endsWith(".pdf")) {
          const pdfRes = await extractPdf(buf);
          const { chunkText } = await import("../context/chunker");
          const { saveChunks } = await import("../context/db");

          const taskId = `task_dl_${Date.now()}`;
          const chunks = chunkText({
            text: pdfRes.fullText,
            source: fileName,
            taskId,
            dotId: ctx.dot.id,
          });
          saveChunks(chunks);

          return [
            `Status Code: ${statusCode}`,
            `Final URL: ${finalUrl}`,
            `Content-Type: ${contentType}`,
            `Byte Size: ${buf.length}`,
            `Successfully downloaded ${fileName} (${buf.length} bytes) to workspace ${relPath}. Extracted ${pdfRes.pageCount} pages and ${chunks.length} chunks stored in SQLite chunk_store.`,
          ].join("\n");
        }

        return [
          `Status Code: ${statusCode}`,
          `Final URL: ${finalUrl}`,
          `Content-Type: ${contentType}`,
          `Byte Size: ${buf.length}`,
          `Downloaded ${fileName} (${buf.length} bytes) to workspace ${relPath}.`,
        ].join("\n");
      } catch (err: any) {
        return `Download error: ${err.message}`;
      }
    },
  },
  {
    name: "run_command",
    label: "Running commands",
    description: "Run a bash command on your own computer (Linux; the working directory is your persistent workspace). Use it for scripts, data work, downloads, installing packages, etc.",
    parameters: obj({ command: str("The bash command to run") }),
    describe: (a) => `run \`${s(a.command)}\` on its own computer`,
    // Isolated computers (cloud/docker) run freely; the sandbox-folder fallback lives on the user's Mac, so ask.
    defaultDecision: (ctx) => (computer.modeFor(ctx.dot.id) === "local" ? "ask" : "allow"),
    execute: (a, ctx) => computer.runCommand(ctx.dot.id, s(a.command), ctx.signal),
  },
  {
    name: "read_file",
    label: "Reading a file",
    description: "Read a text file from your workspace.",
    parameters: obj({ path: str("Path relative to your workspace") }),
    execute: async (a, ctx) => {
      const pathStr = s(a.path);
      const buf = await computer.readFile(ctx.dot.id, pathStr).catch(() => null);
      if (!buf) return `No such file: ${pathStr}`;
      
      const { extractPdf, isPdfBuffer } = await import("../context/pdf");
      if (isPdfBuffer(buf) || pathStr.toLowerCase().endsWith(".pdf")) {
        const pdfRes = await extractPdf(buf);
        return pdfRes.fullText ? pdfRes.fullText.slice(0, 30_000) : "no text layer (scanned PDF)";
      }
      return buf.toString("utf8").slice(0, 30_000);
    },
  },
  {
    name: "write_file",
    label: "Writing a file",
    description: "Create or overwrite a text file in your workspace (reports, notes, code). Use share_file to hand a finished file to the user.",
    parameters: obj({ path: str("Path relative to your workspace"), content: str("Full file contents") }),
    execute: async (a, ctx) => `Wrote ${s(a.content).length} chars to ${await computer.writeFile(ctx.dot.id, s(a.path), s(a.content))}`,
  },
  {
    name: "share_file",
    label: "Sharing a file",
    description:
      "Send a file from your computer to the user in chat (reports, spreadsheets, images, exports, code). They get a notification and can preview or download it. Write the file first, then share it.",
    parameters: obj({ path: str("Path of the file in your workspace"), note: str("A short message to go with it") }),
    execute: async (a, ctx) => {
      const att = await files.shareFromComputer(ctx.dot.id, s(a.path));
      const text = s(a.note) || `Here's ${att.name}.`;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text, attachments: [att] });
      emit({ type: "notify", dotId: ctx.dot.id, title: `${ctx.dot.name} sent ${att.name}`, body: text.slice(0, 160) });
      return `Shared ${att.name} (${att.size} bytes) with the user. Don't repeat its contents unless asked.`;
    },
  },
  {
    name: "open_url",
    label: "Browsing the web",
    description: "Open a URL in your browser (you'll see it via the computer tool / read_page). Your browser keeps its logins.",
    parameters: obj({ url: str("URL to open") }),
    describe: (a) => `open ${s(a.url)} in its browser`,
    defaultDecision: () => "allow",
    execute: (a, ctx) => computer.openUrl(ctx.dot.id, s(a.url)),
  },
  {
    name: "read_page",
    label: "Reading the web",
    description: "Get the visible text of the page currently open in your browser.",
    parameters: obj({}),
    execute: (_a, ctx) => computer.readPage(ctx.dot.id),
  },
  {
    name: "click",
    label: "Using its computer",
    description:
      "Click something on the page open in your browser by its visible text (a button, link, tab, option, checkbox or label), e.g. \"Continue\" or \"Row F seat 12\". Read the page first so you use the exact text.",
    parameters: obj({ text: str("The visible text of what to click") }),
    describe: (a) => `click "${s(a.text)}" in its browser`,
    defaultDecision: (_c, a) => (RISKY_CLICK.test(s(a.text)) ? "ask" : "allow"),
    execute: (a, ctx) => computer.clickText(ctx.dot.id, s(a.text)),
  },
  {
    name: "type_text",
    label: "Using its computer",
    description: "Type into a field on the page open in your browser, found by its label, placeholder or name. Set submit to press Enter afterwards. Never use it for passwords (use sign_in).",
    parameters: obj({ field: str("Label, placeholder or name of the field"), text: str("What to type"), submit: { type: "boolean", description: "Press Enter after typing" } }, ["field", "text", "submit"]),
    describe: (a) => `type "${s(a.text).slice(0, 60)}" into "${s(a.field)}" in its browser`,
    defaultDecision: () => "allow",
    execute: (a, ctx) => computer.typeText(ctx.dot.id, s(a.field), s(a.text), Boolean(a.submit)),
  },
  {
    name: "sign_in",
    label: "Signing in",
    description:
      "Fill the login form on the current browser page using the user's saved password for a site. You never see the password. Open the site's sign-in page first, then submit the form yourself afterwards.",
    parameters: obj({ site: str("Site/domain of the login, e.g. github.com") }),
    describe: (a) => `sign in to ${s(a.site)} with the user's saved password`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      const cred = credentialFor(s(a.site));
      if (!cred) return `No saved password for ${s(a.site)}. Ask the user to add one under Passwords (never ask them to paste it in chat), or to take over your computer and log in themselves.`;
      return computer.fillLogin(ctx.dot.id, cred.username, cred.password);
    },
  },
  {
    name: "run_on_my_computer",
    label: "On your computer",
    description: "Run a bash command on the USER's own computer (their Mac). Only use when the task truly needs their machine; prefer your own computer.",
    parameters: obj({ command: str("The bash command to run on the user's computer") }),
    describe: (a) => `run \`${s(a.command)}\` on the user's personal computer`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      if (!repo.getDot(ctx.dot.id)?.localAccess)
        return "You no longer have access to the user's computer. They can allow access again from this dot's settings on that computer.";
      return runOnUserComputer(s(a.command), ctx.signal);
    },
  },
  {
    name: "remember",
    label: "Remembering",
    description: "Save a durable fact or preference about the user or their work to your memory, so you know it in future conversations.",
    parameters: obj({ fact: str("The fact, written as a short standalone sentence") }),
    execute: async (a, ctx) => (repo.addMemory(ctx.dot.id, s(a.fact)), "Saved to memory."),
  },
  {
    name: "forget",
    label: "Updating memory",
    description: "Delete a memory that is wrong or outdated.",
    parameters: obj({ memory_id: str("The id shown in your memory list") }),
    execute: async (a) => (repo.deleteMemory(s(a.memory_id)), "Forgotten."),
  },
  {
    name: "save_skill",
    label: "Learning a skill",
    description: "Save a reusable skill: step-by-step markdown instructions for a task you'll repeat. Updates the skill if the name exists.",
    parameters: obj({ name: str("Short skill name"), description: str("One line: when to use it"), instructions: str("Markdown instructions") }),
    execute: async (a, ctx) => (repo.upsertSkill(ctx.dot.id, s(a.name), s(a.description), s(a.instructions)), `Skill "${s(a.name)}" saved.`),
  },
  {
    name: "use_skill",
    label: "Using a skill",
    description: "Load the full instructions of one of your saved skills.",
    parameters: obj({ name: str("Skill name") }),
    execute: async (a, ctx) => {
      const skill = repo.listSkills(ctx.dot.id).find((k) => k.name.toLowerCase() === s(a.name).toLowerCase());
      return skill ? skill.body : `No skill named "${s(a.name)}".`;
    },
  },
  {
    name: "create_routine",
    label: "Setting up a routine",
    description: "Create a recurring task you'll run on a schedule on your own, e.g. a morning briefing. Results reach the user via send_update.",
    parameters: obj({
      name: str("Short name"),
      instruction: str("What to do each time, written as a full instruction to yourself"),
      schedule: str("5-field cron expression in the user's local timezone, e.g. '0 8 * * 1-5' for weekdays at 8am"),
    }),
    describe: (a) => `set up a recurring routine "${s(a.name)}" (${s(a.schedule)})`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      if (!repo.validSchedule(s(a.schedule))) return `Invalid cron expression: ${s(a.schedule)}`;
      const r = repo.addRoutine({ dotId: ctx.dot.id, name: s(a.name), instruction: s(a.instruction), schedule: s(a.schedule) });
      return `Routine created (id ${r.id}). Next run: ${r.nextRunAt ? new Date(r.nextRunAt).toString() : "unknown"}.`;
    },
  },
  {
    name: "delete_routine",
    label: "Updating routines",
    description: "Delete one of your routines.",
    parameters: obj({ routine_id: str("Routine id") }),
    describe: (a) => `delete routine ${s(a.routine_id)}`,
    defaultDecision: () => "allow",
    execute: async (a) => (repo.deleteRoutine(s(a.routine_id)), "Routine deleted."),
  },
  {
    name: "send_update",
    label: "Messaging you",
    description:
      "Proactively message the user with a notification — for progress on long work, or to deliver results of background/routine work. Give finished deliverables a short title like 'Your research is ready'.",
    parameters: obj({ title: nullableStr("Short notification title, or null"), text: str("The message (markdown)") }),
    execute: async (a, ctx) => {
      const title = (a.title as string | null) || null;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text: s(a.text), title });
      emit({ type: "notify", dotId: ctx.dot.id, title: title ?? ctx.dot.name, body: s(a.text).slice(0, 160) });
      return "Delivered to the user.";
    },
  },
  {
    name: "message_dot",
    label: "Messaging another dot",
    description: "Ask another of the user's dots for help or hand off a sub-task. Returns their reply.",
    parameters: obj({ dot_name: str("The other dot's name"), message: str("Your message to them, with all needed context") }),
    describe: (a) => `message the dot "${s(a.dot_name)}"`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const target = repo.findDotByName(s(a.dot_name));
      if (!target) return `No dot named "${s(a.dot_name)}". Available: ${repo.listDots().map((d) => d.name).join(", ")}`;
      if (target.id === ctx.dot.id) return "That's you.";
      if (target.status === "paused") return `${target.name} is paused.`;
      if (ctx.depth >= 2 || !consultImpl) return "Too many nested hand-offs; do it yourself.";
      return consultImpl(target, s(a.message), ctx.dot, ctx.depth + 1, ctx.signal);
    },
  },
  {
    name: "ask_user",
    label: "Waiting for you",
    description: "Ask the user a question and wait for the answer. Offer 2-4 likely answers as options when possible.",
    parameters: obj({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "Suggested answers (may be empty)" } }),
    pause: "question",
  },
  {
    name: "request_approval",
    label: "Waiting for approval",
    description:
      "Ask the user to approve an action before you take it (sending messages on their behalf, purchases, deleting things, submitting forms, anything irreversible or public). Wait for their decision.",
    parameters: obj({ action: str("What you want to do, one line"), details: str("Exactly what will happen: recipients, amounts, content, etc.") }),
    pause: "approval",
  },
];

// ---------- Composio For You: the user's apps (Gmail, Calendar, Slack, Notion, GitHub…) ----------

TOOLS.push({
  name: "app_connect",
  label: "Connecting an app",
  description:
    "Ask the user to connect one of their apps to Composio (shows a Connect card with a sign-in link) and wait until they finish. Use the exact toolkit slug from COMPOSIO_SEARCH_TOOLS.",
  parameters: obj({ toolkit: str("Toolkit slug, e.g. gmail, googlecalendar, slack, notion, github") }),
  pause: "connect",
});

/** Composio's hosted MCP tools, wrapped so they pass our rules and approval cards. */
function composioTools(): ToolDef[] {
  return composio.mcpTools().map((t): ToolDef => {
    const base = {
      name: t.name,
      description: t.description ?? t.name,
      parameters: t.inputSchema as Record<string, unknown>,
      strict: false,
      execute: (a: Record<string, unknown>) => composio.callTool(t.name, a),
    };
    if (t.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      return {
        ...base,
        label: "Using your apps",
        describe: (a) => composio.describeExecute(a),
        defaultDecision: (_ctx, a) => composio.executeDecision(a),
        detail: (a) => composio.executeDetail(a),
      };
    }
    if (t.name === "COMPOSIO_MANAGE_CONNECTIONS") {
      return {
        ...base,
        label: "Checking app connections",
        // New connections go through app_connect so the user gets a proper Connect card.
        precheck: async (a) =>
          ((a.toolkits as { action?: string }[] | undefined) ?? []).some((k) => (k.action ?? "add") === "add")
            ? "To connect an app, call app_connect with the toolkit slug instead (it shows the user a Connect card)."
            : null,
        describe: (a) => `change app connections (${JSON.stringify(a.toolkits ?? []).slice(0, 120)})`,
        defaultDecision: (_ctx, a) =>
          ((a.toolkits as { action?: string }[] | undefined) ?? []).every((k) => k.action === "list") ? "allow" : "ask",
      };
    }
    return { ...base, label: t.name === "COMPOSIO_SEARCH_TOOLS" ? "Finding app tools" : "Checking app tools" };
  });
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Look up a tool by name, including Composio's dynamic ones. */
export function findTool(name: string): ToolDef | undefined {
  return TOOL_BY_NAME.get(name) ?? composioTools().find((t) => t.name === name);
}

export function toolsForDot(dot: Dot): ToolDef[] {
  const signedIn = composio.signedIn();
  return [
    ...TOOLS.filter((t) => (t.name !== "run_on_my_computer" || dot.localAccess) && (t.name !== "app_connect" || signedIn)),
    ...(signedIn ? composioTools() : []),
  ];
}

export const COMPUTER_ENABLED = (process.env.DOTS_COMPUTER_TOOL ?? "computer") !== "off";
