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
const playwrightDir = path.dirname(fs.realpathSync(require.resolve("playwright/package.json")));
const coreDir = path.dirname(createRequire(path.join(playwrightDir, "package.json")).resolve("playwright-core/package.json"));
for (const dir of [playwrightDir, fs.realpathSync(coreDir)]) {
  const dest = path.join(out, path.relative(root, dir));
  fs.cpSync(dir, dest, { recursive: true, dereference: true });
  console.log("copied", path.relative(root, dir));
}

// Tracing also misses Next's own prebuilt server runtimes (e.g. the one API routes load).
const nextDir = fs.realpathSync(path.dirname(require.resolve("next/package.json")));
fs.cpSync(path.join(nextDir, "dist/compiled/next-server"), path.join(out, path.relative(root, nextDir), "dist/compiled/next-server"), {
  recursive: true,
  filter: (src) => fs.statSync(src).isDirectory() || /\.prod\.js$/.test(src),
});
console.log("copied next/dist/compiled/next-server (production runtimes)");

const swcHelpersDir = fs.realpathSync(path.dirname(require.resolve("@swc/helpers/package.json")));
fs.cpSync(swcHelpersDir, path.join(out, path.relative(root, swcHelpersDir)), { recursive: true });
console.log("copied @swc/helpers");

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
