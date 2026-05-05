// Apply 0027_speed_stake_caps_tunable.sql to RDS staging.
// Idempotent: ON CONFLICT DO NOTHING on the seed inserts, CREATE OR REPLACE
// on the function body.
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
  new URL("../drizzle/migrations/0027_speed_stake_caps_tunable.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0027_speed_stake_caps_tunable.sql…");
await c.query(sql);
console.log("✅ done\n");

const fee = await c.query(`
  SELECT fee_type, rate FROM fee_config
  WHERE fee_type IN ('speed_stake_max_usd', 'speed_cap_per_side_usd')
  ORDER BY fee_type
`);
console.log("Seeded fee_config rows:");
console.table(fee.rows);

console.log("\nspeed_execute_trade now reads from fee_config:");
const fn = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='speed_execute_trade' AND pronamespace='public'::regnamespace`);
const body = fn.rows[0].def;
for (const l of body.split('\n')) {
  if (/v_stake_max\s*:=|v_cap_per_side\s*:=|speed_stake_max_usd|speed_cap_per_side_usd/.test(l)) {
    console.log("  " + l.trim());
  }
}

await c.end();
console.log("\n✅ Verification complete");
