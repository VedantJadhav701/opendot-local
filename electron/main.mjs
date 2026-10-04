// Open Dot desktop shell. Runs the Next.js standalone server as a background process (Electron's own Node,
// so nothing else needs installing) and shows it in a window. Closing the window keeps the server running,
// so dots keep working and routines keep firing; quit from the menu or with ⌘Q.

import { app, BrowserWindow, shell, session, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";

// Fixed, because Composio's sign-in redirects back to this address.
const PORT = Number(process.env.OPEN_DOT_PORT || 3100);
// Development: point the window at `pnpm dev` instead of starting the bundled server.
const DEV_URL = process.env.OPEN_DOT_DEV_URL;
const APP_URL = DEV_URL || `http://localhost:${PORT}`;
const isOurs = (url) => {
  try {
    const u = new URL(url);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1") && Number(u.port) === Number(new URL(APP_URL).port);
  } catch {
    return false;
  }
};

let server = null;
let win = null;
let quitting = false;

// Apps opened from Finder get a bare PATH; dots need the user's tools (git, docker, python, brew…).
function loginPath() {
  if (process.platform === "win32") {
    return process.env.PATH || "";
  }
  try {
    const shellPath = process.env.SHELL || "/bin/zsh";
    return execFileSync(shellPath, ["-ilc", "printf %s \"$PATH\""], { timeout: 5000, encoding: "utf8" }).trim();
  } catch {
    return ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(":");
  }
}

function startServer() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(import.meta.dirname, "..", ".next", "standalone");
  if (!fs.existsSync(path.join(dir, "server.js"))) {
    dialog.showErrorBox("Open Dot Local", `The app server is missing (${dir}). Run \`pnpm desktop:prepare\` first.`);
    app.exit(1);
    return;
  }
  const dataDir = path.join(app.getPath("userData"), "data");
  const log = fs.createWriteStream(path.join(app.getPath("userData"), "server.log"), { flags: "a" });
  server = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: loginPath(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DOTS_DATA_DIR: dataDir,
      DOTS_PUBLIC_URL: `http://localhost:${PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on("exit", (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox("Open Dot Local", `The app server stopped (code ${code}). Details are in ${path.join(app.getPath("userData"), "server.log")}.`);
    app.quit();
  });
}

function waitForServer(timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${APP_URL}/globe.svg`, (res) => (res.resume(), resolve()));
      req.on("error", () => (Date.now() - started > timeoutMs ? reject(new Error("The app server didn't start.")) : setTimeout(tick, 250)));
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

const LOADING = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0;background:#f6f6f6;font-family:-apple-system,system-ui,sans-serif;color:#0a0a0a}
  body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px}
  .dots{display:flex}.dots span{width:18px;height:18px;border-radius:50%;margin-left:-5px;box-shadow:0 0 0 3px #f6f6f6;animation:b 1.2s ease-in-out infinite}
  .dots span:nth-child(1){background:#0a0a0a}.dots span:nth-child(2){background:#51a2ff;animation-delay:.15s}.dots span:nth-child(3){background:#c8f169;animation-delay:.3s}
  @keyframes b{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  p{margin:0;font-size:13px;color:#0a0a0a8c}
</style></head><body><div class="dots"><span></span><span></span><span></span></div><p>Starting Open Dot Local…</p></body></html>`)}`;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: "Open Dot Local",
    backgroundColor: "#f6f6f6",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank") return { action: "allow", overrideBrowserWindowOptions: { show: false } };
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => {
    const forward = (e, maybeUrl) => {
      const url = typeof maybeUrl === "string" ? maybeUrl : e?.url;
      if (!url || !/^https?:/.test(url)) return;
      void shell.openExternal(url);
      if (!child.isDestroyed()) child.destroy();
    };
    child.webContents.on("will-navigate", forward);
    child.webContents.on("did-start-navigation", forward);
    setTimeout(() => !child.isDestroyed() && child.destroy(), 30_000);
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isOurs(url) || url.startsWith("data:")) return;
    e.preventDefault();
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
  });

  win.on("close", (e) => {
    if (process.platform === "darwin" && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => (win = null));
  return win;
}

const ALLOWED = new Set(["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]);
function setPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(ALLOWED.has(permission) && isOurs(details.requestingUrl || "")),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && isOurs(origin || ""));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) createWindow().loadURL(APP_URL);
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    setPermissions();
    createWindow();
    await win.loadURL(LOADING);
    if (!DEV_URL) startServer();
    try {
      await waitForServer();
      await win.loadURL(APP_URL);
    } catch (err) {
      dialog.showErrorBox("Open Dot", `${err.message}\n\nDetails are in ${path.join(app.getPath("userData"), "server.log")}.`);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (win) win.show();
    else createWindow().loadURL(APP_URL);
  });

  app.on("before-quit", () => {
    quitting = true;
    server?.kill("SIGTERM");
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
