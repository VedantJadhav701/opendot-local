import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function generateProvenance() {
  const baseCommit = "d212bbb8397782fa3ade8725fef234cd95ca891e";
  console.log(`Calculating provenance against base commit ${baseCommit.slice(0, 7)}...`);

  // Get list of tracked files in HEAD
  const currentFilesRaw = execSync("git ls-files", { encoding: "utf8" });
  const currentFiles = currentFilesRaw.split("\n").map((f) => f.trim()).filter(Boolean);

  // Get list of tracked files in base commit
  const baseFilesRaw = execSync(`git ls-tree -r --name-only ${baseCommit}`, { encoding: "utf8" });
  const baseFilesSet = new Set(baseFilesRaw.split("\n").map((f) => f.trim()).filter(Boolean));

  const report: { file: string; currentLines: number; baseLines: number; unchangedLines: number; percentUnchanged: number }[] = [];

  for (const file of currentFiles) {
    // Skip binary files or lock files if wanted, but include code/md files
    if (file.startsWith("node_modules/") || file.startsWith(".next/") || file.startsWith("dist/")) continue;

    let currentContent = "";
    try {
      currentContent = fs.readFileSync(file, "utf8");
    } catch {
      continue; // skip binary
    }

    const currentLinesArr = currentContent.split("\n");
    const currentLines = currentLinesArr.length;

    if (!baseFilesSet.has(file)) {
      // New file added after base commit
      report.push({
        file,
        currentLines,
        baseLines: 0,
        unchangedLines: 0,
        percentUnchanged: 0,
      });
      continue;
    }

    // Get base content
    let baseContent = "";
    try {
      baseContent = execSync(`git show ${baseCommit}:${file}`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    } catch {
      report.push({
        file,
        currentLines,
        baseLines: 0,
        unchangedLines: 0,
        percentUnchanged: 0,
      });
      continue;
    }

    const baseLinesArr = baseContent.split("\n");
    const baseLines = baseLinesArr.length;

    // Use diff to count deleted lines from base
    const diffStat = execSync(`git diff -U0 ${baseCommit} HEAD -- "${file}"`, { encoding: "utf8" });
    const diffLines = diffStat.split("\n");

    let deletedFromBase = 0;
    for (const line of diffLines) {
      if (line.startsWith("@@")) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))?/);
        if (match) {
          const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
          deletedFromBase += count;
        }
      }
    }

    const unchangedLines = Math.max(0, baseLines - deletedFromBase);
    const percentUnchanged = Math.min(100, Math.round((unchangedLines / Math.max(1, currentLines)) * 100));

    report.push({
      file,
      currentLines,
      baseLines,
      unchangedLines,
      percentUnchanged,
    });
  }

  // Rank by highest percentage of inherited code (most unchanged lines vs upstream)
  report.sort((a, b) => b.percentUnchanged - a.percentUnchanged || b.unchangedLines - a.unchangedLines);

  let md = `# Codebase Provenance Report\n\n`;
  md += `**Base Commit**: \`${baseCommit.slice(0, 7)}\` (Initial open-dot commit)\n`;
  md += `**Generated**: ${new Date().toISOString()}\n\n`;
  md += `This report lists all codebase files ranked by percentage of inherited (unchanged) lines compared to the upstream base commit, to guide progressive rewriting.\n\n`;
  md += `| Rank | File | Current Lines | Base Lines | Unchanged Lines | % Inherited from Upstream |\n`;
  md += `|---|---|---|---|---|---|\n`;

  report.forEach((item, idx) => {
    md += `| ${idx + 1} | \`${item.file}\` | ${item.currentLines} | ${item.baseLines} | ${item.unchangedLines} | **${item.percentUnchanged}%** |\n`;
  });

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(path.join("docs", "provenance.md"), md);
  console.log(`Saved docs/provenance.md with ${report.length} files analyzed.`);
}

generateProvenance();
