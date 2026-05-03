// Apply 0007_chart_rpcs.sql to RDS staging.
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0007_chart_rpcs.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0007_chart_rpcs.sql ...");
try {
  await client.query(sql);
  console.log("OK — chart RPCs installed");

  const fns = await client.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('get_admin_sidebar_counts','get_speed_price_history','get_speed_klines','get_speed_volatility') ORDER BY routine_name"
  );
  console.log("Installed:", fns.rows.map((r) => r.routine_name));

  const fc = await client.query(
    "SELECT fee_type, rate FROM fee_config WHERE fee_type = 'speed_iv_btc'"
  );
  console.log("seeded fee_config row:");
  console.table(fc.rows);
} finally {
  await client.end();
}
