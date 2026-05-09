#!/usr/bin/env node
// Activate GOLD markets (5m + 1m). Reversible by --revert.
//
// Two flips:
//   1. speed_assets.GOLD.enabled = TRUE  (worker reads at boot)
//   2. fee_config.speed_gold_markets_enabled = 1  (cron + RPC gate)
//
// AFTER running this: re-run `bash scripts/deploy-paxg-oracle.sh` so the
// worker picks up GOLD and starts streaming PAXG ticks.
//
//   node scripts/activate-gold.mjs           # enable
//   node scripts/activate-gold.mjs --revert  # disable

import { config } from "dotenv";
import pg from "pg";

// Next.js convention: .env.local takes precedence over .env
config({ path: ".env.local" });
config({ path: ".env" });

const REVERT = process.argv.includes("--revert");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}

const cleanUrl = url.replace(/[?&]sslmode=[^&]+/, "");
const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  // Show current state
  const sBefore = await client.query(
    `SELECT id, enabled FROM speed_assets WHERE id='GOLD'`,
  );
  const fBefore = await client.query(
    `SELECT rate FROM fee_config WHERE fee_type='speed_gold_markets_enabled'`,
  );
  console.log(`[before] speed_assets.GOLD.enabled = ${sBefore.rows[0]?.enabled ?? "(missing)"}`);
  console.log(`[before] speed_gold_markets_enabled = ${fBefore.rows[0]?.rate ?? "(missing)"}`);

  // Apply both flips in a single transaction so they're atomic
  await client.query("BEGIN");
  const r1 = await client.query(
    `UPDATE speed_assets SET enabled=$1 WHERE id='GOLD' RETURNING enabled`,
    [!REVERT],
  );
  if (r1.rowCount === 0) {
    await client.query("ROLLBACK");
    console.error("ERROR: speed_assets row 'GOLD' not found");
    process.exit(1);
  }
  const r2 = await client.query(
    `UPDATE fee_config SET rate=$1 WHERE fee_type='speed_gold_markets_enabled' RETURNING rate`,
    [REVERT ? 0 : 1],
  );
  if (r2.rowCount === 0) {
    await client.query("ROLLBACK");
    console.error("ERROR: fee_config row 'speed_gold_markets_enabled' not found");
    process.exit(1);
  }
  await client.query("COMMIT");

  console.log(`[after]  speed_assets.GOLD.enabled = ${r1.rows[0].enabled}`);
  console.log(`[after]  speed_gold_markets_enabled = ${r2.rows[0].rate}`);

  if (REVERT) {
    console.log("✓ GOLD markets DISABLED. Existing GOLD positions resolve normally.");
  } else {
    console.log("✓ GOLD markets ENABLED in DB.");
    console.log("");
    console.log("NEXT: re-run the oracle deploy so the worker picks up PAXG:");
    console.log("  bash scripts/deploy-paxg-oracle.sh");
    console.log("");
    console.log("Then verify:");
    console.log("  SELECT asset, price, received_at FROM speed_oracle_latest;");
    console.log("  -- expect both BTC and GOLD rows with recent received_at");
  }
} finally {
  await client.end();
}
