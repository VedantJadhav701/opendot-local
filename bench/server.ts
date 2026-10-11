import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = 4010;
const OUT_DIR = path.join(__dirname, "fixtures", "out");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

// Only pages are served. The .txt copies and manifest.json hold the answer positions and are for the harness only.
const SERVABLE = new Set([".html", ".pdf"]);

export function startBenchmarkServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent((req.url?.split("?")[0] || "/").replace(/^\/+/, "")) || "index.html";
      const filePath = path.resolve(OUT_DIR, name);
      const ext = path.extname(filePath).toLowerCase();

      // no path traversal, no non-page files
      if (!filePath.startsWith(OUT_DIR + path.sep) || !SERVABLE.has(ext) || !fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(filePath).pipe(res);
    });

    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    // let close() finish even if the agent keeps a connection open
    const origClose = server.close.bind(server);
    server.close = ((cb?: (err?: Error) => void) => {
      (server as any).closeAllConnections?.();
      return origClose(cb);
    }) as typeof server.close;
  });
}

if (require.main === module) {
  startBenchmarkServer().then(() => {
    console.log(`Benchmark fixture server running at http://127.0.0.1:${PORT}`);
  });
}
