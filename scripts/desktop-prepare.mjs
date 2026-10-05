// Finish .next/standalone for the desktop app: copy the static assets the minimal server serves,
// and the full Playwright packages (tracing only picks up the files it can see being required).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".next/standalone");
if (!fs.existsSync(path.join(out, "server.js"))) throw new Error("Run `next build` first (output: standalone).");

fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.cpSync(path.join(root, ".next/static"), path.join(out, ".next/static"), { recursive: true });

const require = createRequire(path.join(root, "package.json"));
const EXTERNALS = ["playwright", "playwright-core", "pdf-parse", "pdfjs-dist", "@swc/helpers", "@next/env"];
const nextNodeModules = path.join(out, ".next/node_modules");

for (const pkg of EXTERNALS) {
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`);
    const realDir = fs.realpathSync(path.dirname(pkgJson));
    
    const destRoot = path.join(out, "node_modules", pkg);
    fs.cpSync(realDir, destRoot, { recursive: true, dereference: true });

    if (fs.existsSync(nextNodeModules)) {
      const destNext = path.join(nextNodeModules, pkg);
      fs.cpSync(realDir, destNext, { recursive: true, dereference: true });
    }
    console.log(`copied ${pkg} to standalone node_modules & .next/node_modules`);
  } catch (err) {
    console.warn(`Could not copy ${pkg}:`, err.message);
  }
}

const require = createRequire(path.join(root, "package.json"));
const nextDir = fs.realpathSync(path.dirname(require.resolve("next/package.json")));
fs.cpSync(path.join(nextDir, "dist/compiled/next-server"), path.join(out, path.relative(root, nextDir), "dist/compiled/next-server"), {
  recursive: true,
  filter: (src) => fs.statSync(src).isDirectory() || /\.prod\.js$/.test(src),
});
console.log("copied next/dist/compiled/next-server (production runtimes)");

// Playwright mentions electron, so tracing drags it in; the app already runs inside Electron.
const pnpmDir = path.join(out, "node_modules/.pnpm");
for (const d of fs.existsSync(pnpmDir) ? fs.readdirSync(pnpmDir) : []) if (/^electron(-builder)?@/.test(d)) fs.rmSync(path.join(pnpmDir, d), { recursive: true, force: true });
fs.rmSync(path.join(out, "node_modules/electron"), { recursive: true, force: true });

// Keep only what the server runs.
const KEEP = new Set([".next", "node_modules", "public", "server.js", "package.json"]);
for (const entry of fs.readdirSync(out)) if (!KEEP.has(entry)) fs.rmSync(path.join(out, entry), { recursive: true, force: true });

const app = path.join(root, ".desktop/server");
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(path.dirname(app), { recursive: true });

fs.cpSync(out, app, { recursive: true, dereference: false });

console.log("desktop server ready:", path.relative(root, app));
