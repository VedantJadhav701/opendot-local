import type { ChunkRecord } from "./chunker";

/**
 * Neighbor Expansion: For top ranked chunks, include position-1 and position+1 adjacent chunks.
 */
export function expandNeighbors(
  selectedChunks: ChunkRecord[],
  allChunks: ChunkRecord[]
): ChunkRecord[] {
  if (!selectedChunks.length || !allChunks.length) return selectedChunks;

  const positionMap = new Map<number, ChunkRecord>();
  for (const chunk of allChunks) {
    if (chunk.status !== "dropped" && chunk.status !== "flagged") {
      positionMap.set(chunk.position, chunk);
    }
  }

  const resultSet = new Map<string, ChunkRecord>();

  for (const chunk of selectedChunks) {
    resultSet.set(chunk.id, chunk);

    // Neighbor position - 1
    const prevChunk = positionMap.get(chunk.position - 1);
    if (prevChunk) {
      resultSet.set(prevChunk.id, prevChunk);
    }

    // Neighbor position + 1
    const nextChunk = positionMap.get(chunk.position + 1);
    if (nextChunk) {
      resultSet.set(nextChunk.id, nextChunk);
    }
  }

  // Sort by original position ASC to maintain document flow
  return Array.from(resultSet.values()).sort((a, b) => a.position - b.position);
}
