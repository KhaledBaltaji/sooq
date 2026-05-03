// Apply 0008_speed_oracle_ticks_unique.sql to RDS staging.
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0008_speed_oracle_ticks_unique.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0008_speed_oracle_ticks_unique.sql ...");
try {
  await client.query(sql);
  console.log("OK");

  const r = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'speed_oracle_ticks' ORDER BY indexname"
  );
  console.table(r.rows);
} finally {
  await client.end();
}
