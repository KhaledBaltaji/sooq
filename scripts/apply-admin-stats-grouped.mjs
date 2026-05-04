// Apply 0024_admin_stats_grouped.sql to RDS staging.
//
// Adds two admin-only RPCs:
//   - get_stats_market_pnl_grouped(p_from, p_to, p_duration)
//   - get_stats_market_trades(p_asset, p_duration, p_market_id, p_from, p_to, p_limit)
//
// Verifies post-apply: both functions exist with the expected signatures
// and a non-admin caller hits the SECURITY DEFINER guard (RAISE EXCEPTION).
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
  new URL("../drizzle/migrations/0024_admin_stats_grouped.sql", import.meta.url),
  "utf-8",
);

console.log("Applying 0024_admin_stats_grouped.sql…");
await c.query(sql);
console.log("✅ migration applied");

console.log("\nVerifying RPCs:");
for (const fn of ["get_stats_market_pnl_grouped", "get_stats_market_trades"]) {
  const sig = await c.query(
    `SELECT pg_get_function_arguments(p.oid) AS args,
            pg_get_function_result(p.oid)    AS returns
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname=$1`,
    [fn],
  );
  if (sig.rowCount === 0) {
    console.log(`  ❌ ${fn}: MISSING`);
  } else {
    console.log(`  ✅ ${fn}`);
    console.log(`     args:    ${sig.rows[0].args}`);
    console.log(`     returns: ${sig.rows[0].returns}`);
  }
}

console.log("\nGuard check (no app.user_id set → must throw):");
try {
  await c.query(`SELECT * FROM public.get_stats_market_pnl_grouped(NULL, NULL, NULL) LIMIT 1`);
  console.log("  ❌ guard did NOT trip — admin gate is broken");
} catch (err) {
  if (err.message.includes("Unauthorized")) {
    console.log("  ✅ guard tripped: " + err.message.split("\n")[0]);
  } else {
    console.log("  ❓ unexpected error: " + err.message.split("\n")[0]);
  }
}

console.log("\nSample run as admin (sets app.user_id GUC):");
const adminQ = await c.query(`SELECT id FROM users WHERE is_admin = TRUE LIMIT 1`);
if (adminQ.rowCount === 0) {
  console.log("  ⚠ no admin in users table — skipping sample run");
} else {
  const adminId = adminQ.rows[0].id;
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.user_id', $1, true)", [adminId]);
  const grouped = await c.query(
    `SELECT * FROM public.get_stats_market_pnl_grouped(NULL, NULL, NULL)`,
  );
  console.log(`  grouped: ${grouped.rowCount} bucket(s)`);
  for (const r of grouped.rows) {
    console.log(
      `    ${r.asset} · ${r.duration} — ${r.markets_total} markets, stakes_in=$${r.stakes_in}, net=$${r.platform_net}`,
    );
  }
  if (grouped.rowCount > 0) {
    const sampleAsset = grouped.rows[0].asset;
    const sampleDur = grouped.rows[0].duration;
    const trades = await c.query(
      `SELECT * FROM public.get_stats_market_trades($1, $2, NULL, NULL, NULL, 5)`,
      [sampleAsset, sampleDur],
    );
    console.log(`  trades for ${sampleAsset}·${sampleDur}: ${trades.rowCount} row(s)`);
  }
  await c.query("ROLLBACK");
}

await c.end();
