import crypto from "node:crypto";

export type RawChunkInput = {
  text: string;
  source: string;
  page?: number;
  taskId: string;
  dotId: string;
};

export type ChunkRecord = {
  id: string;
  taskId: string;
  dotId: string;
  source: string;
  page?: number;
  position: number;
  text: string;
  contentHash: string;
  status: "pending" | "kept" | "maybe" | "dropped" | "flagged";
  createdAt: number;
};

export const HARD_MAX_TOKENS = 450;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(the\s+)?above/i,
  /system\s+prompt/i,
  /you\s+are\s+now\s+a/i,
  /developer\s+mode/i,
  /override\s+(all\s+)?instructions/i,
  /bypass\s+security/i,
];

export function isInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function computeHash(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Approximate token count (approx. 4 chars per token). */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into 200-400 token chunks on paragraph/heading boundaries with 10-15% overlap,
 * strictly bounded by a hard max token cap (default 450 tokens).
 */
export function chunkText(
  input: RawChunkInput,
  targetTokens = 300,
  maxTokens = HARD_MAX_TOKENS,
  overlapRatio = 0.12
): ChunkRecord[] {
  const cleanText = input.text.trim();
  if (!cleanText) return [];

  // Split into paragraphs / headings
  const rawBlocks = cleanText.split(/\n{2,}|(?=^#{1,6}\s+)/m).map((b) => b.trim()).filter(Boolean);

  // Sub-split any single block that exceeds maxTokens into sentence/word level units
  const atomicUnits: string[] = [];
  for (const block of rawBlocks) {
    if (countTokens(block) <= maxTokens) {
      atomicUnits.push(block);
    } else {
      // Split on sentences
      const sentences = block.split(/(?<=[.!?])\s+/).filter(Boolean);
      for (const s of sentences) {
        if (countTokens(s) <= maxTokens) {
          atomicUnits.push(s);
        } else {
          // Sentence itself exceeds maxTokens: split strictly on words / 400 token slice boundaries
          const words = s.split(/\s+/);
          let subStr = "";
          for (const w of words) {
            if (countTokens(subStr + " " + w) > maxTokens && subStr.trim()) {
              atomicUnits.push(subStr.trim());
              subStr = w;
            } else {
              subStr += (subStr ? " " : "") + w;
            }
          }
          if (subStr.trim()) atomicUnits.push(subStr.trim());
        }
      }
    }
  }

  const chunks: ChunkRecord[] = [];
  const seenHashes = new Set<string>();

  let currentBlockTexts: string[] = [];
  let currentTokenCount = 0;
  let position = 0;

  for (let i = 0; i < atomicUnits.length; i++) {
    const unit = atomicUnits[i];
    const unitTokens = countTokens(unit);

    if (currentTokenCount + unitTokens > targetTokens && currentBlockTexts.length > 0) {
      pushChunk();
    }

    currentBlockTexts.push(unit);
    currentTokenCount += unitTokens;

    // Hard max check: force immediate flush if current chunk exceeds maxTokens
    if (currentTokenCount >= maxTokens) {
      pushChunk();
    }
  }

  if (currentBlockTexts.length > 0) {
    pushChunk();
  }

  function pushChunk() {
    const text = currentBlockTexts.join("\n\n").trim();
    if (!text) return;

    // Safety fallback: if combined chunk text exceeds maxTokens, trim strictly
    let finalChunkText = text;
    if (countTokens(finalChunkText) > maxTokens) {
      finalChunkText = finalChunkText.slice(0, maxTokens * 4).trim();
    }

    const hash = computeHash(finalChunkText);
    const isDup = seenHashes.has(hash);
    seenHashes.add(hash);

    const flagged = isInjection(finalChunkText);
    const chunkId = `chk_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    chunks.push({
      id: chunkId,
      taskId: input.taskId,
      dotId: input.dotId,
      source: input.source,
      page: input.page,
      position: position++,
      text: finalChunkText,
      contentHash: hash,
      status: flagged ? "flagged" : isDup ? "dropped" : "pending",
      createdAt: Date.now(),
    });

    // Compute overlap for next chunk
    const overlapTokensTarget = Math.floor(targetTokens * overlapRatio);
    let overlapText = "";
    let overlapTokens = 0;

    for (let i = currentBlockTexts.length - 1; i >= 0; i--) {
      const b = currentBlockTexts[i];
      const bt = countTokens(b);
      if (overlapTokens + bt <= overlapTokensTarget || overlapTokens === 0) {
        overlapText = b + (overlapText ? "\n\n" + overlapText : "");
        overlapTokens += bt;
      } else {
        break;
      }
    }

    currentBlockTexts = overlapText ? [overlapText] : [];
    currentTokenCount = overlapTokens;
  }

  return chunks;
}
