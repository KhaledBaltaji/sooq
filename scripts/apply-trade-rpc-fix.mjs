// Apply 0009_speed_trade_enum_fix.sql to RDS staging.
import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const sql = readFileSync(
  new URL("../drizzle/migrations/0009_speed_trade_enum_fix.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0009_speed_trade_enum_fix.sql…");
await client.query(sql);
console.log("✅ done");

const fees = await client.query(
  "SELECT fee_type, rate FROM fee_config WHERE fee_type IN ('speed_handle_fee_pct','speed_spread_pct') ORDER BY fee_type"
);
console.log("\nfee_config rows now seeded:");
console.table(fees.rows);

await client.end();
