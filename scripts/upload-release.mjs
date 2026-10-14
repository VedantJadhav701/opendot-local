import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = path.resolve(import.meta.dirname, "..");
const exePath = path.join(root, "dist", "OpenDot-local-Setup-0.2.0.exe");

async function askToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Please enter your GitHub Personal Access Token (classic or fine-grained with repo scope): ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function upload() {
  if (!fs.existsSync(exePath)) {
    console.error(`Error: File not found at ${exePath}`);
    console.error("Please run `pnpm desktop:build:win` first to build the installer.");
    process.exit(1);
  }

  const stats = fs.statSync(exePath);
  console.log(`Found installer: ${exePath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  const token = await askToken();
  if (!token) {
    console.error("No GitHub token provided. Cannot upload to GitHub Releases.");
    process.exit(1);
  }

  const uploadUrl = "https://uploads.github.com/repos/VedantJadhav701/opendot-local/releases/411530252/assets?name=OpenDot-local-Setup-0.2.0.exe";

  console.log("Uploading OpenDot-local-Setup-0.2.0.exe to GitHub Release v0.2.0...");
  const stream = fs.createReadStream(exePath);

  let uploadedBytes = 0;
  stream.on("data", (chunk) => {
    uploadedBytes += chunk.length;
    const pct = ((uploadedBytes / stats.size) * 100).toFixed(1);
    process.stdout.write(`\rUploading: ${pct}% (${(uploadedBytes / 1024 / 1024).toFixed(1)} / ${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  });

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": stats.size.toString(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: stream,
    duplex: "half",
  });

  console.log("");
  if (res.ok) {
    const data = await res.json();
    console.log("✅ Successfully uploaded installer to GitHub Releases!");
    console.log(`Download URL: ${data.browser_download_url}`);
  } else {
    const errText = await res.text();
    console.error(`❌ Upload failed with HTTP ${res.status}: ${errText}`);
  }
}

upload().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
