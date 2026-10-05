import "./shim-server-only.cjs";
import { db } from "../src/server/db";
import * as repo from "../src/server/repo";

async function main() {
  console.log("Updating dot names in SQLite database...");
  const count = db().prepare("UPDATE dots SET name = 'OpenDot-local' WHERE lower(name) LIKE '%opendot%' OR lower(name) LIKE '%open dot%'").run();
  console.log(`Updated ${count.changes} dot rows to 'OpenDot-local'.`);

  const dots = repo.listDots();
  console.log("Current Dots in DB:");
  for (const d of dots) {
    console.log(`  - ID: ${d.id}, Name: ${d.name}, Model: ${d.model}`);
  }
}

main().catch(console.error);
