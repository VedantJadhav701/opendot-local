import { rankChunksBM25 } from "./bm25";
import { rankChunksEmbeddings } from "./embed";
import type { ChunkRecord } from "./chunker";

export type RankMode = "bm25" | "embed" | "hybrid";

export type HybridRankResult = {
  chunk: ChunkRecord;
  rrfScore: number;
  bm25Rank?: number;
  embedRank?: number;
};

/**
  Reciprocal Rank Fusion (RRF with k=60) combining BM25 and Cosine Similarity embeddings.
 */
export async function rankChunksHybrid(
  query: string,
  chunks: ChunkRecord[],
  chunkEmbeddingsMap: Map<string, number[]>,
  mode: RankMode = "hybrid",
  rrfK = 60
): Promise<HybridRankResult[]> {
  if (!chunks.length) return [];

  // 1. BM25 Ranking
  const bm25Results = rankChunksBM25(query, chunks);
  const bm25RankMap = new Map<string, number>();
  bm25Results.forEach((res, index) => {
    bm25RankMap.set(res.chunk.id, index + 1);
  });

  if (mode === "bm25") {
    return bm25Results.map((res, index) => ({
      chunk: res.chunk,
      rrfScore: 1 / (rrfK + index + 1),
      bm25Rank: index + 1,
    }));
  }

  // 2. Embeddings Ranking
  const embedResults = await rankChunksEmbeddings(query, chunks, chunkEmbeddingsMap);
  const embedRankMap = new Map<string, number>();
  embedResults.forEach((res, index) => {
    embedRankMap.set(res.chunk.id, index + 1);
  });

  if (mode === "embed") {
    return embedResults.map((res, index) => ({
      chunk: res.chunk,
      rrfScore: 1 / (rrfK + index + 1),
      embedRank: index + 1,
    }));
  }

  // 3. Hybrid RRF (k=60)
  const results: HybridRankResult[] = [];

  for (const chunk of chunks) {
    const rBM25 = bm25RankMap.get(chunk.id) || chunks.length;
    const rEmbed = embedRankMap.get(chunk.id) || chunks.length;

    const rrfScore = 1.0 / (rrfK + rBM25) + 1.0 / (rrfK + rEmbed);

    results.push({
      chunk,
      rrfScore,
      bm25Rank: rBM25,
      embedRank: rEmbed,
    });
  }

  return results.sort((a, b) => b.rrfScore - a.rrfScore);
}
