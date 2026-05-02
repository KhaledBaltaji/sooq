// Quick state probe — pg_cron, deposits/withdrawals tables, what RPCs exist
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const preload = await client.query("SHOW shared_preload_libraries");
console.log("shared_preload_libraries:", preload.rows[0].shared_preload_libraries);

const exts = await client.query(
  "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name IN ('pg_cron', 'pgcrypto') ORDER BY name"
);
console.log("\nExtensions:");
console.table(exts.rows);

const tables = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('deposits','withdrawals','user_wallets','transactions','users','fee_config') ORDER BY table_name"
);
console.log("\nMoney tables present:", tables.rows.map((r) => r.table_name));

const fns = await client.query(
  "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('process_deposit','process_withdrawal','withdrawal_approve','withdrawal_reject') ORDER BY routine_name"
);
console.log("Money RPCs present:", fns.rows.map((r) => r.routine_name));

await client.end();
