#!/usr/bin/env node
// Activate BTC-1m markets. Reversible by setting rate=0.
//
//   node scripts/activate-btc-1m.mjs           # sets rate=1
//   node scripts/activate-btc-1m.mjs --revert  # sets rate=0

import { config } from "dotenv";
import pg from "pg";

// Next.js convention: .env.local takes precedence over .env
config({ path: ".env.local" });
config({ path: ".env" });

const REVERT = process.argv.includes("--revert");
const TARGET = REVERT ? 0 : 1;

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
  const before = await client.query(
    `SELECT rate FROM fee_config WHERE fee_type='speed_1m_markets_enabled'`,
  );
  console.log(`[before] speed_1m_markets_enabled = ${before.rows[0]?.rate ?? "(missing)"}`);

  const res = await client.query(
    `UPDATE fee_config SET rate=$1 WHERE fee_type='speed_1m_markets_enabled' RETURNING rate`,
    [TARGET],
  );
  if (res.rowCount === 0) {
    console.error("ERROR: fee_config row 'speed_1m_markets_enabled' not found");
    process.exit(1);
  }
  console.log(`[after]  speed_1m_markets_enabled = ${res.rows[0].rate}`);
  console.log(REVERT ? "✓ BTC-1m markets DISABLED" : "✓ BTC-1m markets ENABLED");
  console.log("Cron will pick this up on the next 5s tick. New 1m markets open at the next minute boundary.");
} finally {
  await client.end();
}
