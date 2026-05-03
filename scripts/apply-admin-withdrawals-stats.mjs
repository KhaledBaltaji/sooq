// Apply 0015_admin_withdrawals_and_stats.sql to RDS staging.
import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const sql = readFileSync(
  new URL("../drizzle/migrations/0015_admin_withdrawals_and_stats.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0015_admin_withdrawals_and_stats.sql…");
await c.query(sql);
console.log("✅ done");

const fns = await c.query(
  `SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN (
       'get_admin_withdrawals',
       'admin_approve_withdrawal',
       'admin_reject_withdrawal',
       'admin_mark_withdrawal_sent_v2',
       'get_stats_market_pnl',
       'get_stats_user_pnl',
       'get_stats_revenue_summary'
     )
   ORDER BY proname`
);
console.log("\nRPCs created:");
console.table(fns.rows);

await c.end();
