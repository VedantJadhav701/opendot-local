import { chunkText } from "../context/chunker";
import { saveChunks, getTaskChunks } from "../context/db";
import { filterChunks } from "../context/filter";

function runTests() {
  console.log("=== Testing Item 12: Web Page Text Chunker, Chunk Store, BM25, & Evidence Budget ===");

  // Mock Hashnode article content (>15,000 chars)
  let longArticleText = "Hashnode Article Title: Deep Dive into LLM Context Management\n\n";
  for (let i = 1; i <= 50; i++) {
    longArticleText += `Section ${i}: In this section we explore detail #${i}. Machine learning models require careful context optimization, evidence filtering, BM25 ranking, and token budgeting to prevent hallucination and truncation errors. Key insight #${i}: context window efficiency is critical for multi-turn AI reasoning.\n\n`;
  }

  const taskId = `hashnode_test_${Date.now()}`;
  const dotId = "test-dot-item12";

  // 1. Chunk text
  const chunks = chunkText({
    text: longArticleText,
    source: "https://hashnode.com/post/llm-context",
    taskId,
    dotId,
  });

  console.log(`Generated ${chunks.length} chunks from ${longArticleText.length} characters.`);
  if (chunks.length <= 1) {
    throw new Error("Test Failed: Long text was not broken into multiple chunks!");
  }

  // 2. Save to chunk_store
  saveChunks(chunks);
  const stored = getTaskChunks(taskId);
  console.log(`Saved and retrieved ${stored.length} chunks from SQLite chunk_store.`);
  if (stored.length !== chunks.length) {
    throw new Error("Test Failed: SQLite chunk_store count mismatch!");
  }

  // 3. BM25 Filter & Evidence Budget (2500 tokens)
  const filterRes = filterChunks("context window efficiency machine learning", stored, { maxEvidenceTokens: 2500 });
  console.log(`BM25 Selected ${filterRes.selectedChunks.length}/${stored.length} chunks (${filterRes.totalTokens} evidence tokens).`);

  if (filterRes.totalTokens > 2500) {
    throw new Error(`Test Failed: Evidence budget exceeded 2500 tokens (${filterRes.totalTokens})!`);
  }

  console.log("All Item 12 Web Page Chunker & Evidence Budget Tests PASSED!");
}

runTests();
