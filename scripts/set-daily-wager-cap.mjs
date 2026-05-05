// One-shot: set speed_max_user_daily_wager in fee_config.
// Reads/writes RDS staging directly (mirrors apply-*.mjs pattern).
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const NEW_VALUE = Number(process.argv[2]);
if (!Number.isFinite(NEW_VALUE) || NEW_VALUE <= 0) {
  console.error("usage: node scripts/set-daily-wager-cap.mjs <amount-usd>");
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const before = await c.query(`SELECT rate FROM fee_config WHERE fee_type = 'speed_max_user_daily_wager'`);
console.log(`before: $${Number(before.rows[0]?.rate ?? 0).toFixed(2)}`);

await c.query(
  `UPDATE fee_config SET rate = $1, updated_at = NOW() WHERE fee_type = 'speed_max_user_daily_wager'`,
  [NEW_VALUE]
);

const after = await c.query(`SELECT rate, updated_at FROM fee_config WHERE fee_type = 'speed_max_user_daily_wager'`);
console.log(`after:  $${Number(after.rows[0].rate).toFixed(2)} (updated ${after.rows[0].updated_at.toISOString()})`);

await c.end();
console.log("\n✅ done — speed_max_user_daily_wager updated; RPC reads it on every trade, no redeploy needed");
