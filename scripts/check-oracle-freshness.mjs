// scripts/check-oracle-freshness.mjs — exits non-zero if the oracle row
// in `speed_oracle_latest` is more than 5 seconds stale. Used by the
// GitHub Actions oracle-monitor cron (every 5 min) to fire an alert
// when the EC2 worker silently dies.
//
// Usage:
//   node scripts/check-oracle-freshness.mjs           # checks staging RDS via DATABASE_URL
//   node scripts/check-oracle-freshness.mjs --json    # machine-readable output for piping
//
// DATABASE_URL must be set (.env.local locally; GitHub secret in CI).

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const STALE_THRESHOLD_SEC = 5;
const JSON_MODE = process.argv.includes("--json");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const url = process.env.DATABASE_URL.replace(
  /([?&])sslmode=[^&]+(&|$)/i,
  (_m, prefix, suffix) => (suffix === "&" ? prefix : ""),
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const r = await client.query(
    `SELECT asset, EXTRACT(EPOCH FROM (NOW() - received_at)) AS age_sec
     FROM speed_oracle_latest`,
  );

  if (r.rows.length === 0) {
    if (JSON_MODE) console.log(JSON.stringify({ ok: false, reason: "no rows" }));
    else console.error("FAIL: speed_oracle_latest has no rows");
    process.exit(1);
  }

  const oldest = r.rows.reduce((acc, row) =>
    Number(row.age_sec) > Number(acc.age_sec) ? row : acc,
  );
  const ageSec = Number(oldest.age_sec);
  const ok = ageSec < STALE_THRESHOLD_SEC;

  if (JSON_MODE) {
    console.log(
      JSON.stringify({
        ok,
        oldest_asset: oldest.asset,
        oldest_age_sec: Math.round(ageSec * 100) / 100,
        threshold_sec: STALE_THRESHOLD_SEC,
      }),
    );
  } else if (ok) {
    console.log(
      `OK: oldest oracle row is ${oldest.asset}@${ageSec.toFixed(2)}s (threshold ${STALE_THRESHOLD_SEC}s)`,
    );
  } else {
    console.error(
      `FAIL: oldest oracle row is ${oldest.asset}@${ageSec.toFixed(2)}s (threshold ${STALE_THRESHOLD_SEC}s)`,
    );
  }

  process.exit(ok ? 0 : 1);
} finally {
  await client.end().catch(() => {});
}
