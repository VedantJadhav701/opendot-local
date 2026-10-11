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

  // Select chunks within token budget: always include Chunk 1, then top BM25 ranked chunks
  const selectedList: ChunkRecord[] = [];
  const selectedIds = new Set<string>();
  let totalTokens = 0;

  if (alwaysIncludeChunk1 && chunk1) {
    selectedList.push(chunk1);
    selectedIds.add(chunk1.id);
    totalTokens += countTokens(chunk1.text);
  }

  for (const item of topRanked) {
    if (selectedIds.has(item.chunk.id)) continue;
    const tokens = countTokens(item.chunk.text);
    if (totalTokens + tokens <= maxTokens) {
      selectedList.push(item.chunk);
      selectedIds.add(item.chunk.id);
      totalTokens += tokens;
    }
  }

  if (selectedList.length === 0 && validChunks.length > 0) {
    selectedList.push(validChunks[0]);
    totalTokens += countTokens(validChunks[0].text);
  }

  // Sort selected chunks by original position ASC to preserve narrative document order
  const selectedChunks = selectedList.sort((a, b) => a.position - b.position);

  const endTime = Date.now();

  return {
    selectedChunks,
    totalTokens,
    filteredCount: selectedChunks.length,
    totalChunks: chunks.length,
    filterTimeMs: endTime - startTime,
  };
}
