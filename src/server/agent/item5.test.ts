import fs from "node:fs";
import path from "node:path";
import * as computer from "../computer";

function runItem5Tests() {
  console.log("=== Testing Item 5: Dead Code Cleanup & Computer Module ===");

  const deletedFiles = [
    path.join(process.cwd(), "src", "server", "agent", "openrouter.ts"),
    path.join(process.cwd(), "src", "server", "computer", "cdp-helper.ts"),
    path.join(process.cwd(), "src", "server", "computer", "cloud.ts"),
    path.join(process.cwd(), "src", "server", "computer", "sky.ts"),
  ];

  for (const f of deletedFiles) {
    if (fs.existsSync(f)) {
      throw new Error(`FAIL: File "${f}" was NOT deleted!`);
    }
    console.log(`PASS: File "${path.basename(f)}" correctly deleted.`);
  }

  const mode = computer.defaultMode();
  console.log(`PASS: computer.defaultMode() returned "${mode}".`);

  const desc = computer.describe("test-dot-5");
  console.log(`PASS: computer.describe() returned "${desc}".`);

  console.log("All Item 5 Dead Code Cleanup Tests PASSED!");
}

runItem5Tests();
