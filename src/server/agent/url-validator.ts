import type { ChatMessage } from "../llm/types";

/**
 * Validates that every URL in an assistant response appeared in either
 * the user message or a tool result of the turn. Strips hallucinated URLs.
 */
export function sanitizeResponseUrls(text: string, contextMessages: ChatMessage[]): string {
  if (!text) return text;

  const allowedUrls = new Set<string>();
  const urlRegex = /https?:\/\/[^\s)\]]+/gi;

  for (const m of contextMessages) {
    const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m);
    const matches = rawContent.match(urlRegex) || [];
    for (const url of matches) {
      const clean = url.replace(/[.,;)]+$/, "").toLowerCase();
      allowedUrls.add(clean);
      try {
        const parsed = new URL(clean);
        allowedUrls.add(parsed.hostname.toLowerCase());
        allowedUrls.add(parsed.origin.toLowerCase());
      } catch {}
    }
  }

  return text.replace(urlRegex, (matched) => {
    const trailingPunctuation = matched.match(/[.,;)]+$/)?.[0] || "";
    const cleanMatched = matched.replace(/[.,;)]+$/, "");
    const lowerClean = cleanMatched.toLowerCase();

    let isAllowed = allowedUrls.has(lowerClean);
    if (!isAllowed) {
      for (const allowed of allowedUrls) {
        if (allowed.length > 8 && (lowerClean.startsWith(allowed) || allowed.startsWith(lowerClean))) {
          isAllowed = true;
          break;
        }
      }
    }

    if (isAllowed) return matched;
    return `[unverified URL removed]${trailingPunctuation}`;
  });
}
