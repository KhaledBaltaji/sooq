// Apply 0011_cron_gap_and_cashout_shape.sql
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
  new URL("../drizzle/migrations/0011_cron_gap_and_cashout_shape.sql", import.meta.url),
  "utf-8"
);

console.log("Applying 0011_cron_gap_and_cashout_shape.sql…");
await c.query(sql);
console.log("✅ done");

// Quick sanity probe: returns the boundary helper at three sample times
const probes = await c.query(
  `SELECT
     _next_clean_boundary('5m', '2026-05-03 12:05:05'::timestamptz) AS post_5s_after_boundary,
     _next_clean_boundary('5m', '2026-05-03 12:05:35'::timestamptz) AS post_35s_after_boundary,
     _next_clean_boundary('5m', '2026-05-03 12:04:59'::timestamptz) AS pre_1s_before_boundary,
     _next_clean_boundary('5m', '2026-05-03 12:00:00'::timestamptz) AS exact_boundary`
);
console.log("\nBoundary probe:");
console.table(probes.rows);

await c.end();
