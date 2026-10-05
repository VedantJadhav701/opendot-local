import fs from "node:fs";
import path from "node:path";
import { extractPdf } from "../src/server/context/pdf";
import { chunkText } from "../src/server/context/chunker";

function findPatchPdf(): string | null {
  const candidates = [
    path.join(process.cwd(), "uploads", "PatchMLPTS.pdf"),
    path.join(process.cwd(), ".data", "files", "PatchMLPTS.pdf"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const files = fs.readdirSync(process.cwd(), { recursive: true });
  for (const f of files) {
    if (f.toString().toLowerCase().includes("patch") && f.toString().endsWith(".pdf")) {
      return path.join(process.cwd(), f.toString());
    }
  }
  return null;
}

async function runItem6Test() {
  console.log("=== Testing Item 6: PDF Extraction & Regression Check ===");

  const pdfPath = findPatchPdf();
  console.log("Target PDF Path:", pdfPath ?? "NOT FOUND");

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error("FAILED: PatchMLPTS.pdf file not found.");
    process.exit(1);
  }

  const buf = fs.readFileSync(pdfPath);
  console.log("PDF File Size:", buf.length, "bytes");

  const result = await extractPdf(buf);
  console.log("Extracted Page Count:", result.pageCount);
  console.log("Is Scanned?:", result.isScanned);
  console.log("Full Text Length:", result.fullText.length, "chars");

  const chunks = chunkText({
    text: result.fullText,
    source: "PatchMLPTS.pdf",
    taskId: "test_patch_pdf",
    dotId: "test_dot",
  });

  console.log("Total Chunks Created:", chunks.length);
  console.log("Sample First 200 Chars of Page 1:\n", result.fullText.slice(0, 200));

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const report = `=== PDF EXTRACTION TEST REPORT ===\nFile: ${pdfPath}\nSize: ${buf.length} bytes\nPages: ${result.pageCount}\nChunks: ${chunks.length}\nisScanned: ${result.isScanned}\nSample Page 1:\n${result.fullText.slice(0, 500)}\n`;
  fs.writeFileSync(path.join(outDir, "pdf-regression-item6.txt"), report);
  console.log("Saved report to docs/raw/pdf-regression-item6.txt");
}

runItem6Test().catch(console.error);
