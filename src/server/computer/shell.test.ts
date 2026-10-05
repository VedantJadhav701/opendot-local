import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath, workspaceDir } from "./shell";

function runItem1Tests() {
  console.log("=== Testing Item 1: resolveWorkspacePath Security Tests ===");

  const testDotId = "test-security-dot-item1";
  const ws = workspaceDir(testDotId);

  // 1. Test parent traversal "../ws-evil"
  try {
    resolveWorkspacePath(testDotId, "../ws-evil");
    throw new Error("FAIL: Parent traversal '../ws-evil' was not blocked!");
  } catch (err: any) {
    if (!err.message.includes("Path must stay inside /workspace")) throw err;
    console.log("PASS: Parent traversal '../ws-evil' blocked cleanly.");
  }

  // 2. Test absolute Windows path "C:\\Windows"
  try {
    resolveWorkspacePath(testDotId, "C:\\Windows");
    throw new Error("FAIL: Absolute path 'C:\\Windows' was not blocked!");
  } catch (err: any) {
    if (!err.message.includes("Path must stay inside /workspace")) throw err;
    console.log("PASS: Absolute path 'C:\\Windows' blocked cleanly.");
  }

  // 3. Test sibling prefix path "workspace-evil"
  try {
    resolveWorkspacePath(testDotId, "../workspace-evil");
    throw new Error("FAIL: Sibling directory prefix path was not blocked!");
  } catch (err: any) {
    if (!err.message.includes("Path must stay inside /workspace")) throw err;
    console.log("PASS: Sibling directory prefix path blocked cleanly.");
  }

  // 4. Test symlink escape
  const externalDir = path.join(ws, "..", "external-folder-item1");
  fs.mkdirSync(externalDir, { recursive: true });
  const symlinkPath = path.join(ws, "symlink-outside");

  try {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    try {
      fs.symlinkSync(externalDir, symlinkPath, "junction");
    } catch {
      // Junction / symlink creation fallback
      fs.symlinkSync(externalDir, symlinkPath, "dir");
    }

    try {
      resolveWorkspacePath(testDotId, "symlink-outside/secret.txt");
      throw new Error("FAIL: Symlink escape was not blocked!");
    } catch (err: any) {
      if (!err.message.includes("Path must stay inside /workspace")) throw err;
      console.log("PASS: Symlink escape blocked cleanly.");
    }
  } finally {
    try { if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath); } catch {}
    try { if (fs.existsSync(externalDir)) fs.rmdirSync(externalDir); } catch {}
  }

  // 5. Valid path inside workspace
  const validPath = resolveWorkspacePath(testDotId, "valid/subfolder/file.txt");
  console.log("PASS: Valid workspace path resolved:", validPath);

  console.log("All Item 1 Security Tests PASSED!");
}

runItem1Tests();
