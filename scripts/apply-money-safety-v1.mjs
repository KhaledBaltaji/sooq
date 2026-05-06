// Apply 0033_money_safety_v1.sql to RDS staging.
//
// Runs the full migration in a single statement (it's wrapped in BEGIN/COMMIT
// inside the file). Pre-flight checks the current state, post-flight verifies
// every assertion the migration's DO block makes.
//
// Usage: node scripts/apply-money-safety-v1.mjs
// Requires DATABASE_URL in .env.local pointing at RDS staging.

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

console.log("=== Money safety v1 (mig 0033) apply ===\n");

// ---------- Pre-flight ----------
console.log("Pre-flight checks:");

// 1. users_balance_nonneg constraint should NOT exist yet
const preCons = await c.query(`
  SELECT 1 FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.conname = 'users_balance_nonneg' AND t.relname = 'users'
`);
if (preCons.rows.length > 0) {
  console.log("  ⚠️  users_balance_nonneg already exists — migration will DROP and re-add (idempotent)");
} else {
  console.log("  ✅ users_balance_nonneg not present (will be added)");
}

// 2. admin_action_log table should NOT exist yet
const preTable = await c.query(`
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='admin_action_log'
`);
if (preTable.rows.length > 0) {
  console.log("  ⚠️  admin_action_log already exists — migration will skip (CREATE TABLE IF NOT EXISTS)");
} else {
  console.log("  ✅ admin_action_log not present (will be created)");
}

// 3. withdrawals.idempotency_key column
const preCol = await c.query(`
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawals' AND column_name='idempotency_key'
`);
if (preCol.rows.length > 0) {
  console.log("  ⚠️  withdrawals.idempotency_key already exists — migration will skip");
} else {
  console.log("  ✅ withdrawals.idempotency_key not present (will be added)");
}

// 4. speed_execute_cashout overload count (must be 1 — mig 0032 cleanup)
const preCashout = await c.query(`
  SELECT COUNT(*)::int AS n FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
if (preCashout.rows[0].n !== 1) {
  console.error(`  ❌ speed_execute_cashout has ${preCashout.rows[0].n} overloads, expected 1. Run mig 0032 cleanup first.`);
  await c.end();
  process.exit(1);
}
console.log("  ✅ speed_execute_cashout has exactly 1 overload (post-mig-0032)");

// 5. Probe: are there any users with negative balance? (NOT VALID lets us
// add the constraint anyway, but worth flagging.)
const negBal = await c.query(`
  SELECT COUNT(*)::int AS n FROM users WHERE balance_usd < 0
`);
if (negBal.rows[0].n > 0) {
  console.log(`  ⚠️  ${negBal.rows[0].n} user(s) have negative balance — constraint added with NOT VALID, manual cleanup later`);
} else {
  console.log("  ✅ no users with negative balance");
}

// ---------- Apply ----------
const sql = readFileSync(
  new URL("../drizzle/migrations/0033_money_safety_v1.sql", import.meta.url),
  "utf-8"
);

console.log("\nApplying 0033...");
const t0 = Date.now();
await c.query(sql);
console.log(`  ✅ applied in ${Date.now() - t0}ms`);

// ---------- Post-flight ----------
console.log("\nPost-flight verification:");

const postCons = await c.query(`
  SELECT 1 FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.conname = 'users_balance_nonneg' AND t.relname = 'users'
`);
if (postCons.rows.length === 1) console.log("  ✅ users_balance_nonneg constraint present");
else console.error("  ❌ users_balance_nonneg constraint MISSING");

const postTable = await c.query(`
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name='admin_action_log'
`);
if (postTable.rows.length === 1) console.log("  ✅ admin_action_log table present");
else console.error("  ❌ admin_action_log table MISSING");

const postCol = await c.query(`
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='withdrawals' AND column_name='idempotency_key'
`);
if (postCol.rows.length === 1) console.log("  ✅ withdrawals.idempotency_key column present");
else console.error("  ❌ withdrawals.idempotency_key column MISSING");

const postIdx = await c.query(`
  SELECT 1 FROM pg_indexes
  WHERE tablename='withdrawals' AND indexname='withdrawals_idempotency_key_unique'
`);
if (postIdx.rows.length === 1) console.log("  ✅ withdrawals_idempotency_key_unique index present");
else console.error("  ❌ withdrawals_idempotency_key_unique index MISSING");

const postCashout = await c.query(`
  SELECT pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
if (postCashout.rows.length === 1) {
  console.log(`  ✅ speed_execute_cashout: 1 overload (${postCashout.rows[0].args.split(",").length} args)`);
} else {
  console.error(`  ❌ speed_execute_cashout overload count = ${postCashout.rows.length}, expected 1`);
}

console.log("\nDone. Next: smoke-test cashout on staging with a $0 scenario, run scripts/w10-ledger-audit.mjs.");

await c.end();
