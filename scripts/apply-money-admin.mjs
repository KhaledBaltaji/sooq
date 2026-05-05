// Apply 0026_money_admin.sql to RDS staging.
// All RPCs are CREATE OR REPLACE (with explicit DROP for shape changes).
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
  new URL("../drizzle/migrations/0026_money_admin.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0026_money_admin.sql…");
await c.query(sql);
console.log("✅ done\n");

console.log("Verifying RPC signatures:");
const fns = await c.query(`
  SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('get_admin_deposits', 'admin_credit_deposit', 'admin_balance_adjust_v2', 'get_admin_money_ledger', 'admin_search_users')
  ORDER BY proname
`);
console.table(fns.rows);

const admin = await c.query(`SELECT id FROM users WHERE is_admin = TRUE LIMIT 1`);
if (admin.rows.length > 0) {
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', $1::text, true)`, [admin.rows[0].id]);

  const deps = await c.query(`SELECT COUNT(*)::int AS n FROM get_admin_deposits(NULL, 200, 0)`);
  console.log(`\nSmoke get_admin_deposits: ${deps.rows[0].n} rows`);

  const led = await c.query(`SELECT COUNT(*)::int AS n FROM get_admin_money_ledger(NULL, NULL, NULL, NULL, 500, 0)`);
  console.log(`Smoke get_admin_money_ledger: ${led.rows[0].n} rows`);

  const us = await c.query(`SELECT COUNT(*)::int AS n FROM admin_search_users('a', 10)`);
  console.log(`Smoke admin_search_users('a'): ${us.rows[0].n} rows`);

  await c.query("ROLLBACK");
}

await c.end();
console.log("\n✅ Verification complete");
