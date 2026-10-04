import { PDFParse } from "pdf-parse";

export type PdfPage = {
  pageNumber: number;
  text: string;
};

export type PdfExtractResult = {
  pages: PdfPage[];
  fullText: string;
  isScanned: boolean;
  pageCount: number;
};

/**
 * Extract text per page from PDF buffer keeping page numbers.
 * Safe fallback for scanned/empty PDFs.
 */
export async function extractPdf(dataBuffer: Buffer): Promise<PdfExtractResult> {
  const pages: PdfPage[] = [];

  // Handle plain text buffer (e.g., text uploads or converted documents)
  if (!isPdfBuffer(dataBuffer)) {
    const textStr = dataBuffer.toString("utf8").trim();
    if (textStr.length >= 20) {
      return {
        pages: [{ pageNumber: 1, text: textStr }],
        fullText: textStr,
        isScanned: false,
        pageCount: 1,
      };
    }
  }

  try {
    const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
    const textResult = await parser.getText();
    await parser.destroy();

    if (textResult?.pages) {
      for (const p of textResult.pages) {
        pages.push({
          pageNumber: p.num,
          text: (p.text || "").replace(/[ \t]+/g, " ").trim(),
        });
      }
    }

    const totalCleanText = pages.map((p) => p.text).join("").trim();
    const isScanned = totalCleanText.length < 20;

    if (isScanned) {
      return {
        pages: [],
        fullText: "no text layer (scanned PDF)",
        isScanned: true,
        pageCount: pages.length || 0,
      };
    }

    const fullText = pages
      .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
      .join("\n\n")
      .trim();

    return {
      pages,
      fullText,
      isScanned: false,
      pageCount: pages.length,
    };
  } catch (err: any) {
    console.error("[pdf-extract] PDF parser threw an exception:", err);
    return {
      pages: [],
      fullText: `PDF parser threw error: ${err instanceof Error ? err.message : String(err)}`,
      isScanned: false,
      pageCount: 0,
    };
  }
}

/** Helper to check if a buffer starts with %PDF header magic bytes. */
export function isPdfBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}
