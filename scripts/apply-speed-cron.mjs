// Apply 0004_speed_cron.sql to RDS staging (creates pg_cron extension +
// speed_roll_markets + speed_resolve_expired_markets + schedules 5s jobs).
import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "..", "drizzle/migrations/0004_speed_cron.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Applying 0004_speed_cron.sql ...");
try {
  await client.query(sql);
  console.log("OK — pg_cron + speed cron RPCs installed");

  const ext = await client.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron'"
  );
  console.log("\nExtensions:");
  console.table(ext.rows);

  const jobs = await client.query(
    "SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'speed-%' ORDER BY jobname"
  );
  console.log("\npg_cron jobs:");
  console.table(jobs.rows);

  const fns = await client.query(
    "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('speed_roll_markets','speed_resolve_expired_markets','_next_clean_boundary') ORDER BY routine_name"
  );
  console.log("Cron RPCs installed:", fns.rows.map((r) => r.routine_name));

  const seeded = await client.query(
    "SELECT id, display_name, enabled FROM speed_assets ORDER BY id"
  );
  console.log("\nseeded speed_assets:");
  console.table(seeded.rows);

  const flags = await client.query(
    "SELECT fee_type, rate FROM fee_config WHERE fee_type LIKE 'speed_%' ORDER BY fee_type"
  );
  console.log("seeded fee_config:");
  console.table(flags.rows);
} finally {
  await client.end();
}
