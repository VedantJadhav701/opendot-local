import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { addFolder, scanFolder, searchFolder, verifyCitations, removeFolder, listFolders } from "./folder-index";
import { db } from "../db";

async function runTests() {
  console.log("=== Testing Phase E: Ask My Folder Index & Citations ===");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dots-folder-test-"));
  const dotId = "dot_test_folder";

  try {
    // 1. Refuse drive root
    console.log("--- 1. Drive Root Refusal ---");
    const rootPath = path.parse(process.cwd()).root;
    assert.throws(
      () => addFolder(dotId, rootPath),
      /Choose a folder, not a whole drive/,
      "Should refuse whole drive"
    );
    console.log("PASS: Drive root was correctly refused.");

    // 2. Add folder & prepare test files
    console.log("--- 2. Add Folder & Secret File Exclusion ---");
    fs.writeFileSync(path.join(tempDir, "notes.md"), "The hotel confirmation number is HTL-99824 in Paris.");
    fs.writeFileSync(path.join(tempDir, "agenda.txt"), "The project review meeting is scheduled for 3pm tomorrow.");
    // Secret files that must be skipped
    fs.writeFileSync(path.join(tempDir, ".env"), "SECRET_API_KEY=sk_test_supersecret123456");
    fs.writeFileSync(path.join(tempDir, "id_rsa"), "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0");

    const { id: folderId } = addFolder(dotId, tempDir);
    assert.ok(folderId.startsWith("fld_"), "Folder ID should start with fld_");

    const initialList = listFolders(dotId);
    assert.strictEqual(initialList.length, 1);
    assert.strictEqual(initialList[0].id, folderId);
    console.log("PASS: Folder registered successfully.");

    // 3. Scan folder
    console.log("--- 3. Initial Scan ---");
    const scanResult = await scanFolder(folderId);
    // Only notes.md and agenda.txt should be indexed; .env and id_rsa must be ignored
    assert.strictEqual(scanResult.files, 2, `Expected 2 files indexed, got ${scanResult.files}`);
    assert.ok(scanResult.chunks >= 2, "Expected at least 2 chunks created");

    // Check search for indexed content
    const searchRes = searchFolder(folderId, "hotel confirmation number");
    assert.ok(searchRes.selectedChunks.length > 0, "Should find hotel confirmation number");
    assert.ok(searchRes.selectedChunks[0].text.includes("HTL-99824"), "Chunk text should contain confirmation number");

    // Check secrets are NOT in index
    const secretSearch = searchFolder(folderId, "SECRET_API_KEY");
    assert.strictEqual(secretSearch.selectedChunks.length, 0, "Secret file content must never be indexed");
    console.log("PASS: Secrets skipped and indexed files searchable.");

    // 4. Incremental rescan (unmodified files skipped)
    console.log("--- 4. Incremental Rescan ---");
    let progressCalls = 0;
    const rescanResult = await scanFolder(folderId, () => {
      progressCalls++;
    });
    assert.strictEqual(rescanResult.files, 2);
    // Update notes.md with new confirmation number
    fs.writeFileSync(path.join(tempDir, "notes.md"), "The hotel confirmation number is HTL-12345 in London.");
    await scanFolder(folderId);

    const updatedSearch = searchFolder(folderId, "hotel confirmation number");
    assert.ok(updatedSearch.selectedChunks.length > 0);
    assert.ok(updatedSearch.selectedChunks[0].text.includes("HTL-12345"), "Should reflect updated note content");
    assert.ok(!updatedSearch.selectedChunks[0].text.includes("HTL-99824"), "Old content should be replaced");
    console.log("PASS: Incremental update verified.");

    // 5. Deleted file cleanup
    console.log("--- 5. Deleted File Cleanup ---");
    fs.unlinkSync(path.join(tempDir, "agenda.txt"));
    const afterDeleteScan = await scanFolder(folderId);
    assert.strictEqual(afterDeleteScan.files, 1, "Only 1 file should remain");

    const deletedSearch = searchFolder(folderId, "project review meeting");
    assert.strictEqual(deletedSearch.selectedChunks.length, 0, "Deleted file chunks should be cleaned up");
    console.log("PASS: Deleted file chunks removed.");

    // 6. Citation Verification
    console.log("--- 6. Citation Verification ---");
    const retrieved = updatedSearch.selectedChunks;
    const answerWithCitations =
      "Your hotel reservation is confirmed under HTL-12345 [[notes.md]] with extra details [[phantom.pdf#p3]].";
    const verification = verifyCitations(answerWithCitations, retrieved);
    assert.deepStrictEqual(verification.valid, ["notes.md"], "notes.md should be valid");
    assert.deepStrictEqual(verification.invalid, ["phantom.pdf#p3"], "phantom.pdf#p3 should be flagged invalid");
    console.log("PASS: Citation verification validated.");

    // 7. Remove Folder cleanup
    console.log("--- 7. Remove Folder Cleanup ---");
    removeFolder(folderId);
    const finalList = listFolders(dotId);
    assert.strictEqual(finalList.length, 0, "Folder should be removed");

    const remainingChunks = (
      db().prepare("SELECT COUNT(*) as n FROM chunk_store WHERE task_id = ?").get(`folder:${folderId}`) as { n: number }
    ).n;
    assert.strictEqual(remainingChunks, 0, "All chunks should be wiped on remove");
    console.log("PASS: Remove folder purged all data.");

    console.log("\nAll Phase E Ask My Folder Tests PASSED!\n");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
