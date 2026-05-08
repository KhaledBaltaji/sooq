#!/usr/bin/env node
// scripts/audit-zero-cashout-orphans.mjs
//
// Sprint 0 / S0.7 audit: pre-mig-0033 cashout RPC had `IF v_cashout_amount > 0
// THEN ... balance update + transactions insert ... END IF`. A $0 cashout
// (rare but legal — losing position cashed out exactly at stake amount)
// skipped both. speed_trades row exists; transactions row missing.
// Reconciliation breaks if such rows exist.
//
// This script:
//   1. Counts speed_trades rows with kind='cashout' and amount=0
//   2. For each, checks for paired transactions row (type=speed_cashout,
//      reference_id=trade.id)
//   3. Reports orphans (no pair) with date range + sample IDs
//
// Run-only-once. Safe (read-only). If it finds orphans, follow-up is a
// targeted backfill migration that inserts the missing $0 transaction rows.

import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  WITH cashout_trades AS (
    SELECT id, user_id, market_id, position_id, amount, created_at
    FROM speed_trades
    WHERE kind = 'cashout'::speed_trade_kind AND amount = 0
  )
  SELECT
    ct.id AS trade_id,
    ct.user_id,
    ct.market_id,
    ct.position_id,
    ct.created_at,
    EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.reference_id = ct.id
        AND t.type = 'speed_cashout'::transaction_type
    ) AS has_paired_tx
  FROM cashout_trades ct
  ORDER BY ct.created_at;
`);

const total = r.rows.length;
const orphans = r.rows.filter((row) => !row.has_paired_tx);
console.log(`Total $0-cashout speed_trades: ${total}`);
console.log(`Orphans (no paired transactions row): ${orphans.length}`);

if (orphans.length > 0) {
  console.log("\nFirst 10 orphans:");
  console.table(
    orphans.slice(0, 10).map((o) => ({
      trade_id: o.trade_id,
      created_at: o.created_at,
      position_id: o.position_id,
    })),
  );
  console.log("\nDate range:");
  console.log(`  oldest: ${orphans[0].created_at}`);
  console.log(`  newest: ${orphans[orphans.length - 1].created_at}`);
  console.log("\nNext step: write backfill migration to insert missing $0 transaction rows preserving timestamps.");
  process.exit(1);
} else {
  console.log("\nNo orphans found — ledger is clean. No follow-up migration needed.");
}

await c.end();
