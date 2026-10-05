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
      const clean = url.replace(/[.,;:]+$/, "").toLowerCase();
      allowedUrls.add(clean);
      allowedUrls.add(clean.replace(/\/$/, ""));
    }
  }

  return text.replace(urlRegex, (matched) => {
    const trailingPunctuation = matched.match(/[.,;:]+$/)?.[0] || "";
    const cleanMatched = matched.replace(/[.,;:]+$/, "");
    const lowerClean = cleanMatched.toLowerCase();
    const lowerCleanNoSlash = lowerClean.replace(/\/$/, "");

    if (allowedUrls.has(lowerClean) || allowedUrls.has(lowerCleanNoSlash)) {
      return matched;
    }
    return `[unverified URL removed]${trailingPunctuation}`;
  });
}
