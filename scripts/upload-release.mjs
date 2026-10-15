import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import readline from "node:readline";

const root = path.resolve(import.meta.dirname, "..");
const exePath = path.join(root, "dist", "OpenDot-local-Setup-0.2.0.exe");

async function askToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Please enter your GitHub Personal Access Token: ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function upload() {
  if (!fs.existsSync(exePath)) {
    console.error(`Error: File not found at ${exePath}`);
    process.exit(1);
  }

  const stats = fs.statSync(exePath);
  console.log(`Found installer: ${exePath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  const token = await askToken();
  if (!token) {
    console.error("No GitHub token provided.");
    process.exit(1);
  }

  // First, check if an asset with this name already exists in release 411530252 and delete it if so
  const releaseInfoRes = await fetch("https://api.github.com/repos/VedantJadhav701/opendot-local/releases/411530252", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "opendot-release-uploader",
    },
  });

  if (releaseInfoRes.ok) {
    const releaseData = await releaseInfoRes.json();
    const existing = (releaseData.assets || []).find((a) => a.name === "OpenDot-local-Setup-0.2.0.exe");
    if (existing) {
      console.log(`Found existing asset id ${existing.id}, deleting before fresh upload...`);
      await fetch(`https://api.github.com/repos/VedantJadhav701/opendot-local/releases/assets/${existing.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "opendot-release-uploader",
        },
      });
      console.log("Deleted old asset.");
    }
  }

  console.log("Starting upload of OpenDot-local-Setup-0.2.0.exe to GitHub Release v0.2.0...");

  const uploadUrl = new URL("https://uploads.github.com/repos/VedantJadhav701/opendot-local/releases/411530252/assets?name=OpenDot-local-Setup-0.2.0.exe");

  return new Promise((resolve, reject) => {
    const req = https.request(
      uploadUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": stats.size,
          Accept: "application/vnd.github+json",
          "User-Agent": "opendot-release-uploader",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let respBody = "";
        res.on("data", (chunk) => (respBody += chunk));
        res.on("end", () => {
          process.stdout.write("\n");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(respBody);
              console.log("✅ Successfully uploaded installer to GitHub Releases!");
              console.log(`Download URL: ${data.browser_download_url}`);
              resolve(data);
            } catch {
              console.log("✅ Uploaded successfully!");
              resolve(null);
            }
          } else {
            console.error(`❌ Upload failed with status ${res.statusCode}: ${respBody}`);
            reject(new Error(`Upload failed: ${res.statusCode}`));
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error("\n❌ Network error:", err.message);
      reject(err);
    });

    const fileStream = fs.createReadStream(exePath);
    let uploadedBytes = 0;

    fileStream.on("data", (chunk) => {
      uploadedBytes += chunk.length;
      const pct = ((uploadedBytes / stats.size) * 100).toFixed(1);
      process.stdout.write(`\rUploading: ${pct}% (${(uploadedBytes / 1024 / 1024).toFixed(1)} / ${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    });

    fileStream.pipe(req);
  });
}

upload().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
