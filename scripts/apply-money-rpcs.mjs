// Apply 0003_money_rpcs.sql to RDS staging.
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0003_money_rpcs.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0003_money_rpcs.sql ...");
try {
  await client.query(sql);
  console.log("OK — money RPCs installed");

  const fns = await client.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('process_deposit','process_withdrawal','admin_review_withdrawal','admin_mark_withdrawal_sent') ORDER BY routine_name"
  );
  console.log("Installed:", fns.rows.map((r) => r.routine_name));

  const ext = await client.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_cron') ORDER BY extname"
  );
  console.log("Extensions:");
  console.table(ext.rows);
} finally {
  await client.end();
}
