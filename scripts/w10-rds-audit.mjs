// W10 — full RDS staging audit. Confirms the schema, RPCs, pg_cron jobs,
// seeded config, and that no Supabase-era artifacts leaked through.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const sec = (label) => console.log(`\n${"━".repeat(8)} ${label} ${"━".repeat(8)}`);

// 1. Tables
sec("Tables in public schema");
const tables = await c.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
   ORDER BY table_name`
);
console.log(tables.rows.map((r) => r.table_name).join(", "));

// Flag any Supabase legacy
const legacyMatch = tables.rows.filter((r) =>
  /^(amm_state|trades|positions|markets|prelaunch|news|comments|leaderboard|price_alerts|copy_trade|branch|referral|commission|agent|demo_)/i.test(
    r.table_name
  ) && !r.table_name.startsWith("speed_")
);
if (legacyMatch.length) {
  console.log("⚠️  legacy non-speed tables present:", legacyMatch.map((r) => r.table_name));
} else {
  console.log("✅ no legacy LMSR/branches/demo/prelaunch tables");
}

// 2. RPCs
sec("Functions in public schema");
const fns = await c.query(
  `SELECT proname AS name, pg_catalog.pg_get_function_arguments(oid) AS args
   FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname LIKE 'speed%' OR proname IN
       ('process_deposit','process_withdrawal','admin_credit','admin_debit','admin_adjust_balance','admin_freeze_user','admin_unfreeze_user','admin_pin_set','admin_pin_verify','admin_set_role','admin_user_search','get_admin_sidebar_counts','admin_recent_settlements','admin_recent_users','app.user_id')
   ORDER BY name`
);
console.table(fns.rows);

// 3. pg_cron jobs
sec("pg_cron schedule");
const cron = await c.query(
  `SELECT jobname, schedule, command, active
   FROM cron.job ORDER BY jobname`
);
console.table(cron.rows);

const recentRuns = await c.query(
  `SELECT j.jobname,
          count(*) AS runs_5m,
          count(*) FILTER (WHERE d.status='succeeded') AS ok,
          count(*) FILTER (WHERE d.status='failed') AS failed,
          MAX(d.start_time) AS last_run
   FROM cron.job j
   LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid AND d.start_time > NOW() - INTERVAL '5 minutes'
   WHERE j.jobname LIKE 'speed-%'
   GROUP BY j.jobname ORDER BY j.jobname`
);
console.log("Recent 5-min activity:");
console.table(recentRuns.rows);

// 4. fee_config rows
sec("fee_config seed coverage");
const fees = await c.query("SELECT fee_type, rate FROM fee_config ORDER BY fee_type");
console.table(fees.rows);
const expected = new Set([
  "speed_markets_enabled",
  "speed_oracle_stale_seconds",
  "speed_handle_fee_pct",
  "speed_spread_pct",
  "speed_iv_btc",
  ...["5m", "15m", "24h"].flatMap((d) =>
    ["winner", "loser"].flatMap((r) => ["high", "mid", "low"].map((b) => `speed_cashout_${d}_${r}_${b}`))
  ),
]);
const got = new Set(fees.rows.map((r) => r.fee_type));
const missing = [...expected].filter((x) => !got.has(x));
if (missing.length === 0) {
  console.log(`✅ all ${expected.size} expected fee_config rows present`);
} else {
  console.log(`⚠️  missing: ${missing.join(", ")}`);
}

// 5. speed_assets
sec("speed_assets");
const assets = await c.query("SELECT id, display_name, enabled FROM speed_assets");
console.table(assets.rows);

// 6. Drizzle migration tracking — check what __drizzle_migrations has
sec("Drizzle migration tracking");
const drizzleMig = await c.query(
  `SELECT * FROM information_schema.tables WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'`
);
if (drizzleMig.rows.length) {
  const applied = await c.query(
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`
  );
  console.log(`drizzle journal has ${applied.rowCount} entries (latest hash visible):`);
  console.table(applied.rows.map((r) => ({ id: r.id, created: r.created_at })));
} else {
  console.log("⚠️ no drizzle.__drizzle_migrations table — migrations applied via raw scripts");
}

// 7. Oracle health
sec("Oracle freshness");
const ora = await c.query(
  `SELECT asset, price, received_at, EXTRACT(EPOCH FROM (NOW() - received_at)) AS age_sec
   FROM speed_oracle_latest`
);
console.table(ora.rows);

const tickCount = await c.query(`SELECT count(*)::int AS n FROM speed_oracle_ticks`);
console.log(`speed_oracle_ticks total: ${tickCount.rows[0].n}`);

// 8. Markets
sec("speed_markets summary");
const mks = await c.query(
  `SELECT status, count(*)::int AS n, MIN(opens_at) AS first_open, MAX(closes_at) AS last_close
   FROM speed_markets GROUP BY status ORDER BY status`
);
console.table(mks.rows);

// 9. Connection pool / settings
sec("RDS settings");
for (const k of [
  "shared_preload_libraries",
  "max_connections",
  "ssl",
  "log_statement",
  "statement_timeout",
  "idle_in_transaction_session_timeout",
]) {
  const r = await c.query(`SHOW ${k}`);
  console.log(`  ${k} = ${r.rows[0][k]}`);
}

await c.end();
