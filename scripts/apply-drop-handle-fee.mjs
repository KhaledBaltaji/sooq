// Apply 0013_drop_handle_fee_and_polish.sql to RDS staging.
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
  new URL("../drizzle/migrations/0013_drop_handle_fee_and_polish.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0013_drop_handle_fee_and_polish.sql…");
await c.query(sql);
console.log("✅ done");

const fees = await c.query(
  "SELECT fee_type, rate FROM fee_config WHERE fee_type IN ('speed_handle_fee_pct','speed_spread_pct','speed_iv_btc','speed_markets_enabled','speed_oracle_stale_seconds') ORDER BY fee_type"
);
console.log("\nfee_config (post-mig):");
console.table(fees.rows);

const probe = await c.query(
  `SELECT speed_fair_prob_over(0::numeric, 100::numeric, 60::double precision, 0.6::numeric) AS bad_spot_zero,
          speed_fair_prob_over(100::numeric, 0::numeric, 60::double precision, 0.6::numeric) AS bad_strike_zero,
          speed_fair_prob_over(78700::numeric, 78650::numeric, 60::double precision, 0.6::numeric) AS sane`
);
console.log("\nspeed_fair_prob_over guards:");
console.table(probe.rows);

await c.end();
