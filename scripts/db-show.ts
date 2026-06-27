// Quick database inspector. Run with:  npm run db:show
import { db } from "../src/db.js";

const tables = ["salons", "services", "customers", "appointments"];
for (const t of tables) {
  const rows = db.prepare(`SELECT * FROM ${t}`).all();
  console.log(`\n=== ${t} (${rows.length} rows) ===`);
  for (const r of rows) console.log(r);
}
console.log("");
