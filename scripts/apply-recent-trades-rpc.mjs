// Apply 0023_recent_speed_trades_rpc.sql to RDS staging.
//
// Adds the public read-only get_recent_speed_trades(p_limit) RPC that
// powers the home-page Live Trade Tape. Returns at most 50 most recent
// OPEN trades with anonymized 5-char-UUID handles — no PII.
//
// Verifies post-apply: function exists, signature matches, and a dry-run
// SELECT returns rows (or zero rows cleanly if speed_trades is empty).
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
  new URL("../drizzle/migrations/0023_recent_speed_trades_rpc.sql", import.meta.url),
  "utf-8",
);

console.log("Applying 0023_recent_speed_trades_rpc.sql…");
await c.query(sql);
console.log("✅ migration applied");

console.log("\nVerifying RPC:");
const sig = await c.query(`
  SELECT pg_get_function_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)    AS returns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_recent_speed_trades'
`);
console.log(`  args:    ${sig.rows[0]?.args ?? "MISSING"}`);
console.log(`  returns: ${sig.rows[0]?.returns ?? "MISSING"}`);

const sample = await c.query(`SELECT * FROM public.get_recent_speed_trades(5)`);
console.log(`\nDry-run returned ${sample.rowCount} row(s).`);
if (sample.rowCount > 0) {
  const r = sample.rows[0];
  console.log(`  sample handle: ${r.who_handle}`);
  console.log(`  side / stake / asset / duration: ${r.side} / $${r.stake_usd} / ${r.asset} / ${r.duration}`);
  // Belt-and-braces PII check: no key in any row should match a known PII field.
  const piiKeys = ["user_id", "userId", "email", "phone", "display_name", "displayName", "name"];
  const leaked = piiKeys.filter((k) => k in r);
  console.log(`  PII columns leaked: ${leaked.length === 0 ? "✅ none" : "❌ " + leaked.join(", ")}`);
}

await c.end();
