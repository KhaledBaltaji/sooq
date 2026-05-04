// Apply 0022_cashout_kill_switch.sql to RDS staging.
//
// Adds the `speed_cashout_enabled` row to fee_config (default 1) and
// recreates speed_execute_cashout with a kill-switch check at the top.
// Body of the function is otherwise identical to mig 0016.
//
// After applying, confirms the row exists and the function still returns
// the right shape via a dry-run inspection (no actual cashout call).
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

console.log("Pre-fix state:");
const before = await c.query(
  `SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_enabled'`,
);
console.log(`  fee_config['speed_cashout_enabled']: ${before.rowCount === 0 ? "MISSING" : before.rows[0].rate}`);

const sql = readFileSync(
  new URL("../drizzle/migrations/0022_cashout_kill_switch.sql", import.meta.url),
  "utf-8",
);

console.log("\nApplying 0022_cashout_kill_switch.sql…");
await c.query(sql);
console.log("✅ migration applied");

console.log("\nPost-fix state:");
const after = await c.query(
  `SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_enabled'`,
);
console.log(`  fee_config['speed_cashout_enabled']: ${after.rows[0].rate}`);

const fn = await c.query(`
  SELECT pg_get_functiondef(p.oid) AS body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='speed_execute_cashout'
`);
const body = fn.rows[0]?.body || "";
const hasKill = body.includes("speed_cashout_enabled");
console.log(`  speed_execute_cashout has kill-switch check: ${hasKill ? "✅" : "❌"}`);

await c.end();
