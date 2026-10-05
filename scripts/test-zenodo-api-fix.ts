import fs from "node:fs";

async function testZenodoFix() {
  const recordId = "23047307";
  const apiRecordUrl = `https://zenodo.org/api/records/${recordId}`;

  console.log(`Fetching Zenodo API record metadata: ${apiRecordUrl}`);
  const metaRes = await fetch(apiRecordUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  console.log(`API Record Status: ${metaRes.status}`);
  if (metaRes.ok) {
    const data = (await metaRes.json()) as any;
    console.log("Record title:", data.metadata?.title);
    console.log("Files found:", data.files?.length);
    if (data.files && data.files.length > 0) {
      for (const f of data.files) {
        console.log("File entry:", {
          key: f.key,
          size: f.size,
          checksum: f.checksum,
          selfLink: f.links?.self,
          contentLink: f.links?.content,
        });

        const fileDlUrl = f.links?.content || f.links?.self || `https://zenodo.org/records/${recordId}/files/${f.key}?download=1`;
        console.log(`Attempting download from: ${fileDlUrl}`);
        const dlRes = await fetch(fileDlUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          redirect: "follow",
        });

        console.log(`Download Response Status: ${dlRes.status}, Content-Type: ${dlRes.headers.get("content-type")}, Size: ${dlRes.headers.get("content-length")}`);
        if (dlRes.ok) {
          const buf = Buffer.from(await dlRes.arrayBuffer());
          console.log(`Downloaded ${buf.length} bytes successfully!`);
        }
      }
    }
  } else {
    console.log("API Record fetch failed:", await metaRes.text());
  }
}

testZenodoFix().catch(console.error);
