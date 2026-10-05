import fs from "node:fs";
import path from "node:path";

async function main() {
  const targetUrl = "https://zenodo.org/api/files/23cb94edce629b576f8b369208b6d857/PatchMLPTS.pdf";
  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*",
  };

  console.log("Fetching Zenodo direct API URL:", targetUrl);
  const res = await fetch(targetUrl, {
    headers: reqHeaders,
    redirect: "follow",
  });

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    resHeaders[key] = value;
  });

  const text = await res.text();

  const report = [
    "=== ZENODO DIAGNOSTIC TRACE ===",
    `URL: ${targetUrl}`,
    "\n--- REQUEST HEADERS SENT ---",
    JSON.stringify(reqHeaders, null, 2),
    `\n--- RESPONSE STATUS ---`,
    `Status: ${res.status} ${res.statusText}`,
    `Final URL: ${res.url}`,
    "\n--- RESPONSE HEADERS ---",
    JSON.stringify(resHeaders, null, 2),
    "\n--- FIRST 500 CHARACTERS OF BODY ---",
    text.slice(0, 500),
  ].join("\n");

  console.log(report);

  const outDir = path.join(process.cwd(), "docs", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "zenodo-403-diagnosis.txt"), report);
}

main().catch(console.error);
