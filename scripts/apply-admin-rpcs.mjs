// Apply 0006_admin_rpcs.sql to RDS staging.
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0006_admin_rpcs.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0006_admin_rpcs.sql ...");
try {
  await client.query(sql);
  console.log("OK — admin RPCs installed");
  const fns = await client.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('admin_set_pin','admin_has_pin','admin_adjust_balance','toggle_user_freeze','admin_set_admin_role','admin_update_fee') ORDER BY routine_name"
  );
  console.log("Installed:", fns.rows.map((r) => r.routine_name));
} finally {
  await client.end();
}
