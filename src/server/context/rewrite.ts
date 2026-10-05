export type RewriteResult = {
  subquestions: string[];
  keywords: string[];
};

/**
 * Fast Rule-Based & LLM Query Rewrite: Extracts sub-phrases and key search terms for retrieval.
 */
export async function rewriteQuery(query: string): Promise<RewriteResult> {
  if (!query.trim()) return { subquestions: [query], keywords: [] };

  const clean = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const words = clean.split(/\s+/).filter((w) => w.length > 3);

  // Generate sub-phrases / keywords from n-grams
  const keywords = Array.from(new Set(words));
  const subquestions: string[] = [query];

  if (words.length >= 4) {
    const half = Math.floor(words.length / 2);
    subquestions.push(words.slice(0, half).join(" "));
    subquestions.push(words.slice(half).join(" "));
  }

  return { subquestions, keywords };
}
