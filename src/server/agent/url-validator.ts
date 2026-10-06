import type { ChatMessage } from "../llm/types";

// URL ends at whitespace, quotes, brackets, angle brackets or backticks.
const URL_RE = /https?:\/\/[^\s)\]"'<>`\\]+/gi;
const TRAIL_RE = /[.,;:!?)\s\]"*_]+$/;

function norm(u: string): string {
  let s = u.replace(TRAIL_RE, "").toLowerCase();
  s = s.replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
  return s;
}

function variants(u: string): string[] {
  const n = norm(u);
  const noSlash = n.replace(/\/$/, "");
  const baseNoQuery = noSlash.split("?")[0].split("#")[0];
  return [n, noSlash, `${noSlash}/`, baseNoQuery, `${baseNoQuery}/`];
}

/**
 * Every URL in an assistant answer must appear in the user message or in a
 * tool result of this turn. Hallucinated URLs are removed.
 */
export function sanitizeResponseUrls(text: string, contextMessages: ChatMessage[]): string {
  if (!text) return text;

  const allowed = new Set<string>();
  for (const m of contextMessages) {
    const raw = typeof m.content === "string" ? m.content : JSON.stringify(m);
    for (const url of raw.match(URL_RE) || []) {
      for (const v of variants(url)) allowed.add(v);
    }
  }

  return text.replace(URL_RE, (matched) => {
    const trailing = matched.match(TRAIL_RE)?.[0] || "";
    const core = trailing ? matched.slice(0, -trailing.length) : matched;
    if (variants(core).some((v) => allowed.has(v))) return matched;
    return `[unverified URL removed]${trailing}`;
  });
}
