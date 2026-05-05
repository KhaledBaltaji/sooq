// Apply 0025_withdrawal_fee.sql to RDS staging.
// Idempotent: ALTERs use IF NOT EXISTS, fee_config seed uses ON CONFLICT,
// RPCs are CREATE OR REPLACE (with DROP first for shape changes).
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
  new URL("../drizzle/migrations/0025_withdrawal_fee.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0025_withdrawal_fee.sql…");
await c.query(sql);
console.log("✅ done\n");

console.log("Verifying schema:");
const cols = await c.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'withdrawals'
    AND column_name IN ('fee_amount', 'net_amount')
  ORDER BY column_name
`);
console.table(cols.rows);

console.log("\nVerifying fee_config seed:");
const fee = await c.query(
  `SELECT fee_type, rate FROM fee_config WHERE fee_type = 'withdrawal_fee'`
);
console.table(fee.rows);

console.log("\nVerifying RPC signatures:");
const fns = await c.query(`
  SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('process_withdrawal', 'get_admin_withdrawals', 'get_stats_revenue_summary')
  ORDER BY proname
`);
console.table(fns.rows);

console.log("\nSmoke test get_admin_withdrawals as admin:");
const admin = await c.query(`SELECT id FROM users WHERE is_admin = TRUE LIMIT 1`);
if (admin.rows.length > 0) {
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [admin.rows[0].id]);
  const r = await c.query(`SELECT COUNT(*)::int AS n FROM get_admin_withdrawals(NULL, 200, 0)`);
  console.log(`  ✅ get_admin_withdrawals returned ${r.rows[0].n} rows (no error)`);
  await c.query("ROLLBACK");
} else {
  console.log("  (no admin users to smoke test with)");
}

await c.end();
