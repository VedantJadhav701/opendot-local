import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

async function testZenodoPlaywright() {
  console.log("Launching Chromium via Playwright...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const targetUrl = "https://zenodo.org/records/23047307";
  console.log(`Navigating to ${targetUrl}...`);
  const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("Page Response Status:", response?.status());
  const content = await page.content();
  console.log("Page Content Length:", content.length);

  // Extract PDF download link from page DOM
  const pdfHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find((el) => el.href.includes(".pdf") || el.href.includes("/files/"));
    return a ? a.href : null;
  });

  console.log("Extracted PDF href from DOM:", pdfHref);

  if (pdfHref) {
    console.log(`Downloading PDF via Playwright request: ${pdfHref}...`);
    const pdfResponse = await page.request.get(pdfHref);
    console.log("PDF Response Status:", pdfResponse.status(), "Headers:", pdfResponse.headers());
    if (pdfResponse.ok()) {
      const buf = await pdfResponse.body();
      console.log(`Successfully downloaded PDF via Playwright! Bytes: ${buf.length}`);
      const outPath = path.join(process.cwd(), "uploads", "PatchMLPTS.pdf");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      console.log(`Saved to ${outPath}`);
    } else {
      const errText = await pdfResponse.text();
      console.log("PDF download error:", pdfResponse.status(), errText.slice(0, 300));
    }
  }

  await browser.close();
}

testZenodoPlaywright().catch(console.error);
