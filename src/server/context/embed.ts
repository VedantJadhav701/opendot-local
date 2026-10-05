import type { ChunkRecord } from "./chunker";

/** Compute cosine similarity between two float vectors. */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Fetch vector embedding for text using Ollama nomic-embed-text running on CPU (num_gpu: 0). */
export async function fetchEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return [];
  try {
    const res = await fetch("http://127.0.0.1:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: text.slice(0, 2048),
        options: { num_gpu: 0 },
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.embedding || [];
  } catch (e) {
    return [];
  }
}

export type EmbedScoreResult = {
  chunk: ChunkRecord;
  similarity: number;
};

/** Rank chunks using Cosine Similarity over nomic-embed-text embeddings. */
export async function rankChunksEmbeddings(
  query: string,
  chunks: ChunkRecord[],
  chunkEmbeddingsMap: Map<string, number[]>
): Promise<EmbedScoreResult[]> {
  if (!chunks.length || !query.trim()) {
    return chunks.map((chunk) => ({ chunk, similarity: 0 }));
  }

  const queryEmbedding = await fetchEmbedding(query);
  if (!queryEmbedding.length) {
    return chunks.map((chunk) => ({ chunk, similarity: 0 }));
  }

  const results: EmbedScoreResult[] = [];

  for (const chunk of chunks) {
    const chunkEmbed = chunkEmbeddingsMap.get(chunk.id) || [];
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbed);
    results.push({ chunk, similarity });
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}
