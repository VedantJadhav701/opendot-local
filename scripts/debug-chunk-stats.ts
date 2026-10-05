import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText, countTokens } from "../src/server/context/chunker";

async function main() {
  const filePath = path.join(process.cwd(), "uploads", "large_30page_doc.pdf");
  const buf = fs.readFileSync(filePath);
  const ext = await extractPdf(buf);

  const chunks = chunkText({
    text: ext.fullText,
    source: "large_30page_doc.pdf",
    taskId: "debug_t1",
    dotId: "debug_d1",
  });

  const sizes = chunks.map((c) => countTokens(c.text));
  const min = Math.min(...sizes);
  const sum = sizes.reduce((a, b) => a + b, 0);
  const avg = (sum / sizes.length).toFixed(1);
  const max = Math.max(...sizes);
  const dropped = chunks.filter((c) => c.status === "dropped").length;
  const kept = chunks.filter((c) => c.status !== "dropped").length;

  const resultStr = [
    `Extractor Chars: ${ext.fullText.length}`,
    `Total Chunks Generated: ${chunks.length}`,
    `Kept Chunks: ${kept}`,
    `Dropped Duplicate Chunks: ${dropped}`,
    `Min Chunk Tokens: ${min}`,
    `Avg Chunk Tokens: ${avg}`,
    `Max Chunk Tokens: ${max}`,
  ].join("\n");

  fs.writeFileSync("docs/raw/debug-chunk-stats.txt", resultStr, "utf8");
  console.log(resultStr);
}

main().catch(console.error);
