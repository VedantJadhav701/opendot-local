import { assertAllowed, isLocalHost, logRequest, offlineMode, OfflineModeError } from "./netlog";
import { db, setSetting } from "../db";

console.log("=== Testing Privacy Ledger & Offline Mode ===");

// 1. isLocalHost tests
if (!isLocalHost("localhost")) throw new Error("localhost should be local");
if (!isLocalHost("127.0.0.1")) throw new Error("127.0.0.1 should be local");
if (!isLocalHost("::1")) throw new Error("::1 should be local");
if (isLocalHost("example.com")) throw new Error("example.com must not be local");
if (isLocalHost("1.1.1.1")) throw new Error("1.1.1.1 must not be local");
console.log("PASS: isLocalHost checks passed.");

// 2. logRequest strips query string and body
logRequest("https://example.com/api/test?secret_token=12345", "GET", 200, { reason: "web_search" });
const row = db().prepare("SELECT host, path, reason FROM net_log WHERE host = 'example.com' ORDER BY id DESC LIMIT 1").get() as { host: string; path: string; reason: string };
if (!row) throw new Error("logRequest did not insert a row");
if (row.path.includes("secret_token") || row.path.includes("?")) {
  throw new Error(`logRequest leaked query string into database path: ${row.path}`);
}
if (row.reason !== "web_search") throw new Error(`Wrong reason: ${row.reason}`);
console.log("PASS: logRequest correctly stripped query parameters from path.");

// 3. assertAllowed and offlineMode
setSetting("offline_mode", "0");
try {
  assertAllowed("https://example.com/page");
  console.log("PASS: assertAllowed permitted internet host when offline_mode is 0");
} catch (e) {
  throw new Error("assertAllowed should not throw when offline_mode is 0");
}

setSetting("offline_mode", "1");
try {
  assertAllowed("http://127.0.0.1:11434/api/tags");
  console.log("PASS: assertAllowed permitted local host when offline_mode is 1");
} catch (e) {
  throw new Error("assertAllowed blocked local request in offline mode");
}

try {
  assertAllowed("https://example.com/page");
  throw new Error("FAIL: assertAllowed should have blocked example.com in offline mode");
} catch (err: any) {
  if (!(err instanceof OfflineModeError)) throw err;
  console.log("PASS: assertAllowed threw OfflineModeError for internet host in offline mode.");
}

// Clean up
setSetting("offline_mode", "0");
console.log("All Privacy Ledger Unit Tests PASSED!");
