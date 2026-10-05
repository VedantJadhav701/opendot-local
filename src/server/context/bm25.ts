import type { ChunkRecord } from "./chunker";

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is",
  "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
  "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
  "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those",
  "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll",
  "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd",
  "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
]);

/** Basic suffix stemmer */
export function stemWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ly") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Tokenizer: lowercase, strip punctuation, remove stopwords, stem words */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return words
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => stemWord(w));
}

export type BM25ScoreResult = {
  chunk: ChunkRecord;
  score: number;
};

export type BM25Options = {
  k1?: number;
  b?: number;
};

/**
  BM25 Ranking Algorithm over chunk_store records for a task.
 */
export function rankChunksBM25(
  query: string,
  chunks: ChunkRecord[],
  options: BM25Options = {}
): BM25ScoreResult[] {
  if (!chunks.length) return [];

  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return chunks.map((chunk) => ({ chunk, score: 0 }));
  }

  // Precompute doc tokens & lengths
  const docTokensMap = new Map<string, string[]>();
  let totalDocLen = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    docTokensMap.set(chunk.id, tokens);
    totalDocLen += tokens.length;
  }

  const N = chunks.length;
  const avgdl = totalDocLen / N || 1;

  // Calculate Document Frequencies (df) for each query term
  const dfMap = new Map<string, number>();
  for (const qToken of queryTokens) {
    if (dfMap.has(qToken)) continue;
    let count = 0;
    for (const chunk of chunks) {
      const tokens = docTokensMap.get(chunk.id)!;
      if (tokens.includes(qToken)) {
        count++;
      }
    }
    dfMap.set(qToken, count);
  }

  // Calculate BM25 scores
  const results: BM25ScoreResult[] = [];

  for (const chunk of chunks) {
    const tokens = docTokensMap.get(chunk.id)!;
    const docLen = tokens.length;

    // Term frequencies in document
    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    let score = 0;
    for (const qToken of queryTokens) {
      const nq = dfMap.get(qToken) || 0;
      if (nq === 0) continue;

      // BM25 IDF formula with smoothing
      const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1.0);

      const tf = tfMap.get(qToken) || 0;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / avgdl));

      score += idf * (numerator / denominator);
    }

    results.push({ chunk, score });
  }

  // Sort descending by BM25 score
  return results.sort((a, b) => b.score - a.score);
}
