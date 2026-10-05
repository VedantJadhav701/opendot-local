import fs from "node:fs";

async function testHeaders() {
  const recordId = "23047307";

  // Test 1: HTML page scrape for file download link
  console.log("--- Test 1: Fetching HTML page ---");
  const htmlRes = await fetch(`https://zenodo.org/records/${recordId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  console.log("HTML Page Status:", htmlRes.status);
  const html = await htmlRes.text();
  const pdfLinkMatch = html.match(/\/records\/\d+\/files\/[^"?]+\.pdf/i) || html.match(/\/record\/\d+\/files\/[^"?]+\.pdf/i);
  console.log("Extracted PDF link from HTML:", pdfLinkMatch ? pdfLinkMatch[0] : "None");

  if (pdfLinkMatch) {
    const pdfUrl = `https://zenodo.org${pdfLinkMatch[0]}?download=1`;
    console.log("Attempting direct file download from:", pdfUrl);
    const pdfRes = await fetch(pdfUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/pdf,application/octet-stream,*/*",
        "Referer": `https://zenodo.org/records/${recordId}`,
      },
      redirect: "follow",
    });
    console.log("Direct File Download Status:", pdfRes.status, "Content-Type:", pdfRes.headers.get("content-type"));
    if (pdfRes.ok) {
      const buf = Buffer.from(await pdfRes.arrayBuffer());
      console.log(`Success! Downloaded ${buf.length} bytes.`);
    } else {
      const errText = await pdfRes.text();
      console.log("Error Body:", errText.slice(0, 300));
    }
  }

  // Test 2: API with Referer & Chrome headers
  console.log("\n--- Test 2: Fetching API record with Chrome headers ---");
  const apiRes = await fetch(`https://zenodo.org/api/records/${recordId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Referer": `https://zenodo.org/records/${recordId}`,
    },
  });
  console.log("API Status:", apiRes.status);
}

testHeaders().catch(console.error);
