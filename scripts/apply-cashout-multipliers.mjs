// Apply 0010_speed_cashout_multipliers.sql to RDS staging.
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
  new URL("../drizzle/migrations/0010_speed_cashout_multipliers.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0010_speed_cashout_multipliers.sql…");
await client.query(sql);
console.log("✅ done");

const fees = await client.query(
  "SELECT fee_type, rate FROM fee_config WHERE fee_type LIKE 'speed_cashout_%' ORDER BY fee_type"
);
console.log("\ncashout multipliers seeded:");
console.table(fees.rows);

await client.end();
