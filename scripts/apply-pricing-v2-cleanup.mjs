// Drop the old 5-arg / 3-arg overloads of speed_execute_trade and
// speed_execute_cashout left over from migrations 0028 and 0029.
//
// Why this is needed: Postgres CREATE OR REPLACE FUNCTION is matched
// on parameter signature. Migrations 0028 and 0029 recreated the 5-arg
// trade RPC and 3-arg cashout RPC. Mig 0030 added new parameters,
// creating NEW 9-arg trade and 7-arg cashout overloads — the original
// 5-arg/3-arg versions stayed in pg_proc as separate functions.
//
// The trade and cashout API routes call the new 9-arg/7-arg versions
// (updated in src/app/api/speed/{trade,cashout}/route.ts). But any
// code path that calls the OLD 5/3-arg versions bypasses the new
// parity checks AND the mig 0031 soft guards (velocity, open exposure,
// daily-handle alert) — those were only added to the new signatures.
//
// Drop the old overloads to eliminate that risk surface.
//
// Usage: node scripts/apply-pricing-v2-cleanup.mjs

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== Pricing engine v2 cleanup: drop old function overloads ===\n");

console.log("Before:");
const before = await c.query(`
  SELECT proname, pronargs, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN ('speed_execute_trade','speed_execute_cashout')
  ORDER BY proname, pronargs
`);
for (const r of before.rows) {
  console.log(`  ${r.proname}(${r.pronargs} args)`);
}

console.log("\nDropping old 5-arg trade + 3-arg cashout overloads...");
await c.query("BEGIN");
try {
  await c.query(`
    DROP FUNCTION IF EXISTS public.speed_execute_trade(
      uuid, text, numeric, text, decimal
    );
  `);
  await c.query(`
    DROP FUNCTION IF EXISTS public.speed_execute_cashout(
      uuid, text, decimal
    );
  `);
  await c.query("COMMIT");
  console.log("  ✅ old overloads dropped");
} catch (err) {
  await c.query("ROLLBACK");
  console.error(`  ❌ DROP failed: ${err.message}`);
  await c.end();
  process.exit(1);
}

console.log("\nAfter:");
const after = await c.query(`
  SELECT proname, pronargs, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND proname IN ('speed_execute_trade','speed_execute_cashout')
  ORDER BY proname, pronargs
`);
for (const r of after.rows) {
  console.log(`  ${r.proname}(${r.pronargs} args)`);
}

const counts = {
  trade: after.rows.filter((r) => r.proname === "speed_execute_trade").length,
  cashout: after.rows.filter((r) => r.proname === "speed_execute_cashout").length,
};
const tradeArgs = after.rows.find((r) => r.proname === "speed_execute_trade")?.pronargs;
const cashoutArgs = after.rows.find((r) => r.proname === "speed_execute_cashout")?.pronargs;

console.log("");
if (counts.trade === 1 && tradeArgs === 9) {
  console.log("  ✅ exactly one speed_execute_trade with 9 args (parity + soft guards)");
} else {
  console.log(`  ❌ unexpected: ${counts.trade} trade overloads, args=${tradeArgs}`);
}
if (counts.cashout === 1 && cashoutArgs === 7) {
  console.log("  ✅ exactly one speed_execute_cashout with 7 args (parity)");
} else {
  console.log(`  ❌ unexpected: ${counts.cashout} cashout overloads, args=${cashoutArgs}`);
}

await c.end();
console.log("\nDone.");
