// Apply 0014_strike_at_opens_at.sql to RDS staging.
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
  new URL("../drizzle/migrations/0014_strike_at_opens_at.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0014_strike_at_opens_at.sql…");
await c.query(sql);
console.log("✅ done");

const probe = await c.query("SELECT speed_roll_markets() AS r");
console.log("\nFirst roll after migration:", JSON.stringify(probe.rows[0].r, null, 2));

await c.end();
