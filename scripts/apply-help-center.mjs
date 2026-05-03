// Apply 0012_help_center.sql to RDS staging.
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
  new URL("../drizzle/migrations/0012_help_center.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0012_help_center.sql…");
await c.query(sql);
console.log("✅ done");

const t = await c.query(
  `SELECT table_name, count(column_name)::int AS cols
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name IN ('help_collections','help_articles')
   GROUP BY table_name ORDER BY table_name`
);
console.log("\ntables:");
console.table(t.rows);

await c.end();
