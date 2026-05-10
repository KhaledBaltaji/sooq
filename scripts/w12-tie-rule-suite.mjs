#!/usr/bin/env node
/* eslint-disable no-console */
//
// w12-tie-rule-suite.mjs — coverage for mig 0055 (tie-loser settlement rule).
//
// Runs synthetic markets + positions inside isolated ROLLBACK'd transactions
// against staging RDS. Nothing persists; safe to run while the real cron
// rolls + resolves real markets.
//
// Covers both the regression baseline (flag-OFF byte-identical to today)
// AND the new tie-rule branches:
//
//   1.  Flag OFF, close > strike            → outcome = over   (regression)
//   2.  Flag OFF, close < strike            → outcome = under  (regression)
//   3.  Flag OFF, close = strike            → outcome = at_strike + push refund (regression)
//   4.  Flag ON,  close > strike            → outcome = over (rule untouched)
//   5.  Flag ON,  close < strike            → outcome = under (rule untouched)
//   6.  Flag ON,  close = strike, OVER heavy   → outcome = under
//   7.  Flag ON,  close = strike, UNDER heavy  → outcome = over
//   8.  Flag ON,  close = strike, exact 50/50  → outcome deterministic from md5(market_id)
//   9.  Flag ON,  close = strike, total < threshold → outcome deterministic
//  10.  Flag ON,  close = strike, no positions → no crash, deterministic outcome
//  11.  Flag ON,  cashed-out positions excluded → bias reflects open-only stake
//  12.  Flag ON,  re-resolution of a deterministic-fallback market → identical outcome
//  13.  Flag ON,  audit row populated correctly (tie_*) on tie path
//  14.  Flag ON,  audit row tie_rule_applied=FALSE on non-tie close
//  15.  Flag OFF, audit row tie_* columns are all NULL
//
// Usage: node --env-file=.env.local scripts/w12-tie-rule-suite.mjs
// Exit code: 0 = all pass; 1 = any failure.

import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) {
  console.log(`  ✓ ${name}`);
  pass++;
}
function bad(name, detail) {
  console.log(`  ✗ ${name}`);
  console.log(`      ${detail}`);
  fail++;
  failures.push({ name, detail });
}

// Make a deterministic md5-based prediction for what the resolver will pick
// when it falls back to deterministic random. Mirrors the SQL exactly:
//   ('x' || substr(md5(uuid_text), 1, 8))::bit(32)::int % 2
function predictDeterministic(uuid) {
  const md5 = createHash("md5").update(uuid).digest("hex");
  const hex8 = md5.slice(0, 8);
  // 32-bit signed int interpretation matching PG's bit(32)::int
  let n = parseInt(hex8, 16);
  if (n >= 0x80000000) n -= 0x100000000; // sign-extend
  const mod = ((n % 2) + 2) % 2; // PG % is sign-of-dividend; normalize
  return mod === 0 ? "over" : "under";
}

/**
 * Set up a synthetic market + positions, call speed_resolve_market, return
 * the resolver's JSONB result + the audit row + the resulting market row.
 * Caller is inside a transaction that will ROLLBACK.
 */
async function runOneScenario(client, opts) {
  const {
    duration = "1m",
    tieRuleActive,
    strike,
    closePrice,
    overPositions = [],   // [{stake, offered_prob}]
    underPositions = [],  // [{stake, offered_prob}]
    cashedOutPositions = [], // [{side, stake, offered_prob}]
    threshold = 200,      // tie_low_stake_threshold_usd
    marketIdOverride,     // optional fixed UUID for determinism tests
  } = opts;

  const marketId = marketIdOverride ?? randomUUID();
  // Synthetic test user. Ledger writes get rolled back.
  const userId = randomUUID();
  // Use a pre-oracle window: BTC ticks on staging start 2026-05-03. Anchor
  // synthetic markets in mid-2024 so the resolver only sees our test ticks
  // and not the live EC2 oracle stream.
  const baseTime = new Date("2024-06-01T12:00:00.000Z");
  // Add a per-test jitter so concurrent test rows don't tick-collide.
  const jitter = Math.floor(Math.random() * 1_000_000);
  const opensAt = new Date(baseTime.getTime() + jitter);
  const closesAt = new Date(opensAt.getTime() + 60_000); // +60s

  await client.query(
    `INSERT INTO users (id, balance_usd, created_at, updated_at)
     VALUES ($1, 0, NOW(), NOW())`,
    [userId],
  );

  // Make sure the per-market config row reflects the threshold we want.
  // For non-1m durations we still write the row (snapshot reads regardless
  // of duration — the resolver just doesn't fire the tie path on non-1m).
  await client.query(
    `UPDATE speed_market_config
        SET tie_low_stake_threshold_usd = $1
      WHERE asset = 'BTC' AND duration = $2::speed_duration`,
    [threshold, duration],
  );

  // Insert oracle ticks: strike at opens_at - 1s, close at closes_at - 1s.
  await client.query(
    `INSERT INTO speed_oracle_ticks (asset, ts, price)
     VALUES ('BTC', $1, $2)`,
    [new Date(opensAt.getTime() - 1000), strike],
  );
  await client.query(
    `INSERT INTO speed_oracle_ticks (asset, ts, price)
     VALUES ('BTC', $1, $2)`,
    [new Date(closesAt.getTime() - 1000), closePrice],
  );

  // Synthetic market. Snapshot value chosen by caller; status='open' so the
  // resolver will pick it up.
  await client.query(
    `INSERT INTO speed_markets
       (id, asset, duration, opens_at, closes_at, strike_price, status, created_at, tie_loser_rule_active)
     VALUES ($1, 'BTC', $2::speed_duration, $3, $4, $5, 'open', NOW(), $6)`,
    [marketId, duration, opensAt, closesAt, strike, tieRuleActive],
  );

  // Open positions (counted toward bias).
  for (const p of overPositions) {
    await client.query(
      `INSERT INTO speed_positions
         (id, user_id, market_id, side, stake, entry_offered_prob, entry_fair_prob, entry_price, status, created_at)
       VALUES ($1, $2, $3, 'over'::speed_side, $4, $5, $5, $6, 'open', NOW())`,
      [randomUUID(), userId, marketId, p.stake, p.offered_prob, strike],
    );
  }
  for (const p of underPositions) {
    await client.query(
      `INSERT INTO speed_positions
         (id, user_id, market_id, side, stake, entry_offered_prob, entry_fair_prob, entry_price, status, created_at)
       VALUES ($1, $2, $3, 'under'::speed_side, $4, $5, $5, $6, 'open', NOW())`,
      [randomUUID(), userId, marketId, p.stake, p.offered_prob, strike],
    );
  }
  // Cashed-out positions (status='cashed_out') — must NOT count toward bias.
  for (const p of cashedOutPositions) {
    await client.query(
      `INSERT INTO speed_positions
         (id, user_id, market_id, side, stake, entry_offered_prob, entry_fair_prob, entry_price, status, created_at, closed_at, payout_amount)
       VALUES ($1, $2, $3, $4::speed_side, $5, $6, $6, $7, 'cashed_out', NOW(), NOW(), $5)`,
      [randomUUID(), userId, marketId, p.side, p.stake, p.offered_prob, strike],
    );
  }

  const r = await client.query(`SELECT speed_resolve_market($1::uuid) AS res`, [marketId]);
  const result = r.rows[0].res;

  const audit = await client.query(
    `SELECT * FROM speed_market_settlement_audit WHERE market_id = $1`,
    [marketId],
  );

  const market = await client.query(
    `SELECT outcome::text, status::text FROM speed_markets WHERE id = $1`,
    [marketId],
  );

  return { marketId, userId, result, audit: audit.rows[0] ?? null, market: market.rows[0] };
}

async function withRollback(label, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  } catch (e) {
    bad(label, e.message);
  } finally {
    client.release();
  }
}

async function preflight() {
  // Confirm mig 0055 has been applied — bail early if not.
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_name = 'speed_market_config'
          AND column_name = 'tie_loser_rule_enabled') AS cfg_col,
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_name = 'speed_markets'
          AND column_name = 'tie_loser_rule_active') AS market_col,
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_name = 'speed_market_settlement_audit'
          AND column_name = 'tie_rule_applied') AS audit_col
  `);
  const row = r.rows[0];
  if (row.cfg_col === 0 || row.market_col === 0 || row.audit_col === 0) {
    console.error(
      `Pre-flight failed: mig 0055 columns missing. cfg=${row.cfg_col}, market=${row.market_col}, audit=${row.audit_col}.`,
    );
    process.exit(2);
  }
  console.log("Pre-flight OK — mig 0055 columns present.\n");
}

async function main() {
  await preflight();

  // ───────────────────────────────────────────────────────────────────
  // Group 1 — Regression baseline (flag OFF on 1m must be unchanged)
  // ───────────────────────────────────────────────────────────────────
  console.log("Group 1 — Regression (flag OFF, behavior must match today):");

  await withRollback("1.1 flag OFF, close > strike → over", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: false,
      strike: 100.0, closePrice: 100.05,
      overPositions: [{ stake: 100, offered_prob: 0.5 }],
      underPositions: [{ stake: 100, offered_prob: 0.5 }],
    });
    if (result.outcome !== "over") return bad("1.1", `outcome=${result.outcome}`);
    if (audit.tie_rule_applied !== null)
      return bad("1.1 audit", `tie_rule_applied=${audit.tie_rule_applied}, expected NULL`);
    ok("1.1 flag OFF, close > strike → over (audit tie_* NULL)");
  });

  await withRollback("1.2 flag OFF, close < strike → under", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: false,
      strike: 100.0, closePrice: 99.95,
      overPositions: [{ stake: 100, offered_prob: 0.5 }],
      underPositions: [{ stake: 100, offered_prob: 0.5 }],
    });
    if (result.outcome !== "under") return bad("1.2", `outcome=${result.outcome}`);
    if (audit.tie_rule_applied !== null)
      return bad("1.2 audit", `tie_rule_applied=${audit.tie_rule_applied}, expected NULL`);
    ok("1.2 flag OFF, close < strike → under (audit tie_* NULL)");
  });

  await withRollback("1.3 flag OFF, close = strike → at_strike (push)", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: false,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 100, offered_prob: 0.5 }],
      underPositions: [{ stake: 100, offered_prob: 0.5 }],
    });
    if (result.outcome !== "at_strike")
      return bad("1.3", `outcome=${result.outcome}, expected at_strike`);
    if (Number(result.refunded) !== 2)
      return bad("1.3", `refunded=${result.refunded}, expected 2`);
    if (audit.tie_rule_applied !== null)
      return bad("1.3 audit", `tie_rule_applied=${audit.tie_rule_applied}, expected NULL`);
    ok("1.3 flag OFF, close = strike → push refund (audit tie_* NULL)");
  });

  // ───────────────────────────────────────────────────────────────────
  // Group 2 — Flag ON, non-tie close (rule must NOT fire)
  // ───────────────────────────────────────────────────────────────────
  console.log("\nGroup 2 — Flag ON, non-tie close (legacy comparison still wins):");

  await withRollback("2.1 flag ON, close > strike → over (tie_rule_applied=FALSE)", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.05,
      overPositions: [{ stake: 100, offered_prob: 0.5 }],
      underPositions: [{ stake: 100, offered_prob: 0.5 }],
    });
    if (result.outcome !== "over") return bad("2.1", `outcome=${result.outcome}`);
    if (audit.tie_rule_applied !== false)
      return bad("2.1 audit", `tie_rule_applied=${audit.tie_rule_applied}, expected FALSE`);
    if (audit.tie_loser_side !== null)
      return bad("2.1 audit", `tie_loser_side=${audit.tie_loser_side}, expected NULL`);
    ok("2.1 flag ON, non-tie close: outcome correct + audit tie_rule_applied=FALSE");
  });

  await withRollback("2.2 flag ON, close < strike → under", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 99.95,
      overPositions: [{ stake: 500, offered_prob: 0.5 }], // heavy OVER
      underPositions: [{ stake: 100, offered_prob: 0.5 }],
    });
    if (result.outcome !== "under")
      return bad("2.2", `outcome=${result.outcome} (must be under regardless of stake)`);
    if (audit.tie_rule_applied !== false)
      return bad("2.2 audit", `tie_rule_applied=${audit.tie_rule_applied}`);
    ok("2.2 flag ON, close < strike: outcome=under (heavy stake doesn't matter on non-tie)");
  });

  // ───────────────────────────────────────────────────────────────────
  // Group 3 — Flag ON, tie close, imbalance branch
  // ───────────────────────────────────────────────────────────────────
  console.log("\nGroup 3 — Flag ON, tie path, imbalance:");

  await withRollback("3.1 OVER heavier → outcome=under", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 600, offered_prob: 0.55 }],
      underPositions: [{ stake: 400, offered_prob: 0.45 }],
    });
    if (result.outcome !== "under")
      return bad("3.1", `outcome=${result.outcome}, expected under`);
    if (audit.tie_basis !== "imbalance")
      return bad("3.1 audit", `tie_basis=${audit.tie_basis}`);
    if (audit.tie_loser_side !== "over")
      return bad("3.1 audit", `tie_loser_side=${audit.tie_loser_side}`);
    if (Math.abs(Number(audit.tie_imbalance_ratio) - 0.6) > 1e-6)
      return bad("3.1 audit", `imbalance_ratio=${audit.tie_imbalance_ratio}`);
    if (Number(audit.tie_total_stake_usd) !== 1000)
      return bad("3.1 audit", `total_stake=${audit.tie_total_stake_usd}`);
    ok("3.1 OVER heavy → outcome=under, audit columns populated correctly");
  });

  await withRollback("3.2 UNDER heavier → outcome=over", async (c) => {
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 250, offered_prob: 0.4 }],
      underPositions: [{ stake: 750, offered_prob: 0.6 }],
    });
    if (result.outcome !== "over")
      return bad("3.2", `outcome=${result.outcome}, expected over`);
    if (audit.tie_loser_side !== "under")
      return bad("3.2 audit", `tie_loser_side=${audit.tie_loser_side}`);
    if (Math.abs(Number(audit.tie_imbalance_ratio) - 0.75) > 1e-6)
      return bad("3.2 audit", `imbalance_ratio=${audit.tie_imbalance_ratio}`);
    ok("3.2 UNDER heavy → outcome=over, audit columns correct");
  });

  // ───────────────────────────────────────────────────────────────────
  // Group 4 — Flag ON, tie path, deterministic fallback
  // ───────────────────────────────────────────────────────────────────
  console.log("\nGroup 4 — Flag ON, tie path, deterministic fallback:");

  await withRollback("4.1 exact 50/50 → deterministic from md5(market_id)", async (c) => {
    // Force a specific market_id so we can predict the outcome.
    const fixedId = "11111111-1111-1111-1111-111111111111";
    const expected = predictDeterministic(fixedId);
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 500, offered_prob: 0.5 }],
      underPositions: [{ stake: 500, offered_prob: 0.5 }],
      marketIdOverride: fixedId,
    });
    if (result.outcome !== expected)
      return bad("4.1", `outcome=${result.outcome}, expected ${expected} from md5`);
    if (audit.tie_basis !== "deterministic_balanced")
      return bad("4.1 audit", `tie_basis=${audit.tie_basis}`);
    if (audit.tie_imbalance_ratio !== null)
      return bad("4.1 audit", `imbalance_ratio=${audit.tie_imbalance_ratio} on balanced fallback`);
    ok(`4.1 50/50 → outcome=${expected} (deterministic_balanced)`);
  });

  await withRollback("4.2 total < threshold → deterministic_low_stake", async (c) => {
    const fixedId = "22222222-2222-2222-2222-222222222222";
    const expected = predictDeterministic(fixedId);
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 50, offered_prob: 0.5 }],
      underPositions: [{ stake: 30, offered_prob: 0.5 }], // total $80 < $200
      threshold: 200,
      marketIdOverride: fixedId,
    });
    if (result.outcome !== expected)
      return bad("4.2", `outcome=${result.outcome}, expected ${expected}`);
    if (audit.tie_basis !== "deterministic_low_stake")
      return bad("4.2 audit", `tie_basis=${audit.tie_basis}`);
    ok(`4.2 low total stake → outcome=${expected} (deterministic_low_stake)`);
  });

  await withRollback("4.3 no positions → no crash + deterministic", async (c) => {
    const fixedId = "33333333-3333-3333-3333-333333333333";
    const expected = predictDeterministic(fixedId);
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      marketIdOverride: fixedId,
    });
    if (result.outcome !== expected)
      return bad("4.3", `outcome=${result.outcome}, expected ${expected}`);
    if (audit.tie_basis !== "deterministic_low_stake")
      return bad("4.3 audit", `tie_basis=${audit.tie_basis}`);
    if (Number(audit.tie_total_stake_usd) !== 0)
      return bad("4.3 audit", `total_stake=${audit.tie_total_stake_usd}`);
    ok(`4.3 zero positions → outcome=${expected}, no crash`);
  });

  // ───────────────────────────────────────────────────────────────────
  // Group 5 — Cashed-out positions excluded from bias
  // ───────────────────────────────────────────────────────────────────
  console.log("\nGroup 5 — Cashed-out positions excluded:");

  await withRollback("5.1 cashed-out OVER doesn't count toward bias", async (c) => {
    // Open OVER $100, open UNDER $200. UNDER heavy → outcome should be over.
    // Add cashed-out OVER $1000. If counted, OVER would be heavy → outcome
    // would flip to under. We assert it stays over (cashed-out excluded).
    const { result, audit } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 100, offered_prob: 0.5 }],
      underPositions: [{ stake: 200, offered_prob: 0.5 }],
      cashedOutPositions: [{ side: "over", stake: 1000, offered_prob: 0.5 }],
    });
    if (result.outcome !== "over")
      return bad("5.1", `outcome=${result.outcome}, expected over (cashed-out OVER must be excluded)`);
    if (Number(audit.tie_total_stake_usd) !== 300)
      return bad("5.1 audit", `total_stake=${audit.tie_total_stake_usd}, expected 300`);
    ok("5.1 cashed-out positions excluded from bias direction calculation");
  });

  // ───────────────────────────────────────────────────────────────────
  // Group 6 — Determinism on re-resolution
  // ───────────────────────────────────────────────────────────────────
  console.log("\nGroup 6 — Re-resolution determinism:");

  await withRollback("6.1 deterministic outcome stays identical on re-resolve", async (c) => {
    const fixedId = "44444444-4444-4444-4444-444444444444";
    const { result: r1, audit: a1 } = await runOneScenario(c, {
      tieRuleActive: true,
      strike: 100.0, closePrice: 100.0,
      overPositions: [{ stake: 50, offered_prob: 0.5 }],
      underPositions: [{ stake: 50, offered_prob: 0.5 }],
      threshold: 200,
      marketIdOverride: fixedId,
    });
    // Re-call resolve. Market is now 'resolved' so the function will
    // short-circuit ("Market not in resolvable state"). Roll status back
    // to 'open' to force a re-run, then verify outcome is identical.
    await c.query(
      `UPDATE speed_markets SET status='open', outcome=NULL, resolved_at=NULL, twap_at_close=NULL WHERE id=$1`,
      [fixedId],
    );
    // Wipe the prior settlement rows so re-run isn't blocked
    await c.query(`DELETE FROM speed_settlements WHERE market_id=$1`, [fixedId]);
    await c.query(
      `UPDATE speed_positions SET status='open', payout_amount=NULL, closed_at=NULL WHERE market_id=$1`,
      [fixedId],
    );
    const r2 = await c.query(`SELECT speed_resolve_market($1::uuid) AS res`, [fixedId]);
    const a2 = await c.query(
      `SELECT * FROM speed_market_settlement_audit WHERE market_id=$1`,
      [fixedId],
    );
    if (r1.outcome !== r2.rows[0].res.outcome)
      return bad(
        "6.1",
        `r1=${r1.outcome} vs r2=${r2.rows[0].res.outcome}: not deterministic on re-resolve`,
      );
    if (a1.tie_loser_side !== a2.rows[0].tie_loser_side)
      return bad("6.1 audit", `tie_loser_side mismatch on re-run`);
    ok("6.1 deterministic-fallback outcome is idempotent across re-resolutions");
  });

  // ───────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────`);
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  }
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  pool.end();
  process.exit(2);
});
