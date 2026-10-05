import { rankChunksBM25 } from "./bm25";
import { countTokens, type ChunkRecord } from "./chunker";

export type FilterOptions = {
  topPercent?: number; // e.g. 0.30 for top 30%
  scoreThreshold?: number; // min score threshold
  maxEvidenceTokens?: number; // default 2500 tokens
  alwaysIncludeChunk1?: boolean; // default true
  enableEmbeddings?: boolean; // default false
};

export type FilteredChunkResult = {
  selectedChunks: ChunkRecord[];
  totalTokens: number;
  filteredCount: number;
  totalChunks: number;
  filterTimeMs: number;
};

/**
 * Filter chunks using BM25 ranking algorithm, keeping top N% or up to evidence token budget.
 * Always includes Chunk 1 (Position 0, title/abstract) by default.
 * Preserves narrative position order (position ASC) in final output.
 */
export function filterChunks(
  query: string,
  chunks: ChunkRecord[],
  options: FilterOptions = {}
): FilteredChunkResult {
  const startTime = Date.now();
  if (!chunks.length) {
    return {
      selectedChunks: [],
      totalTokens: 0,
      filteredCount: 0,
      totalChunks: 0,
      filterTimeMs: Date.now() - startTime,
    };
  }

  const topPercent = options.topPercent ?? 0.30;
  const maxTokens = options.maxEvidenceTokens ?? 2500;
  const alwaysIncludeChunk1 = options.alwaysIncludeChunk1 ?? true;

  // Filter out dropped or flagged chunks
  const validChunks = chunks.filter((c) => c.status !== "dropped" && c.status !== "flagged");
  if (!validChunks.length) {
    return {
      selectedChunks: [],
      totalTokens: 0,
      filteredCount: 0,
      totalChunks: chunks.length,
      filterTimeMs: Date.now() - startTime,
    };
  }

  // Find Chunk 1 (Position 0 or first chunk in document)
  const chunk1 = validChunks.find((c) => c.position === 0) || validChunks[0];

  // Rank chunks using BM25
  const rankedResults = rankChunksBM25(query, validChunks);

  // Compute cutoff count based on topPercent
  const targetCount = Math.max(1, Math.ceil(validChunks.length * topPercent));
  const topRanked = rankedResults.slice(0, targetCount);

  // Collect candidate chunk set
  const candidateIds = new Set<string>();
  if (alwaysIncludeChunk1 && chunk1) {
    candidateIds.add(chunk1.id);
  }

  for (const item of topRanked) {
    candidateIds.add(item.chunk.id);
  }

  // Filter candidate chunks and sort by original position ASC to preserve narrative order
  const candidates = validChunks
    .filter((c) => candidateIds.has(c.id))
    .sort((a, b) => a.position - b.position);

  // Budget enforcement up to maxEvidenceTokens (2500 tokens)
  const selectedChunks: ChunkRecord[] = [];
  let totalTokens = 0;

  for (const chunk of candidates) {
    const tokens = countTokens(chunk.text);
    if (totalTokens + tokens <= maxTokens) {
      selectedChunks.push(chunk);
      totalTokens += tokens;
    } else if (selectedChunks.length === 0) {
      // Always include at least 1 chunk even if it slightly exceeds
      selectedChunks.push(chunk);
      totalTokens += tokens;
      break;
    } else {
      break;
    }
  }

  const endTime = Date.now();

  return {
    selectedChunks,
    totalTokens,
    filteredCount: selectedChunks.length,
    totalChunks: chunks.length,
    filterTimeMs: endTime - startTime,
  };
}
