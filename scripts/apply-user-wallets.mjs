// Apply 0005_user_wallets.sql to RDS staging.
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0005_user_wallets.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0005_user_wallets.sql ...");
try {
  await client.query(sql);
  console.log("OK — user_wallets created");
  const cols = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_wallets' ORDER BY ordinal_position"
  );
  console.table(cols.rows);
} finally {
  await client.end();
}
