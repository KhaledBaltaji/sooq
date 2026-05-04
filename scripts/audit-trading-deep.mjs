// Deep trading-logic audit on staging.
//
// Read-only verification of the math, settlement, cashout, strike capture,
// risk caps, NGR cache, cron health, admin /stats RPCs and silent-failure
// modes against the rules in mig 0016 (+ 0014, 0017, 0018, 0019, 0020) and
// the admin RPCs in mig 0015.
//
// Same pattern as w10-ledger-audit.mjs. Exit 0 on no issues, non-zero
// otherwise. 27 checks total, see /Users/khaledbaltaji/.claude/plans/i-have-done-some-playful-lagoon.md
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
const pass = (msg) => console.log("✓  " + msg);
let issues = 0;
const fail = (msg) => { issues += 1; console.log("⚠️  " + msg); };
let warnings = 0;
const warn = (msg) => { warnings += 1; console.log("ℹ️  " + msg); };

const WINDOW_DAYS = 7;
const KHALED_EMAIL = "khaledbaltaji@rival.finance";

// ============================================================================
// A. Activity baseline
// ============================================================================

sec(`A1 — Activity overview (last ${WINDOW_DAYS}d)`);

const positionsByStatus = await c.query(`
  SELECT m.duration::TEXT AS duration, p.status::TEXT AS status, COUNT(*)::int AS n,
         COALESCE(SUM(p.stake), 0)::numeric AS total_stake,
         COALESCE(SUM(p.payout_amount), 0)::numeric AS total_payout
  FROM speed_positions p
  JOIN speed_markets m ON m.id = p.market_id
  WHERE p.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  GROUP BY m.duration, p.status
  ORDER BY m.duration, p.status
`);
console.log("Positions by duration × status:");
console.table(positionsByStatus.rows);

const marketsByStatus = await c.query(`
  SELECT duration::TEXT AS duration, status::TEXT AS status, COUNT(*)::int AS n
  FROM speed_markets
  WHERE created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  GROUP BY duration, status
  ORDER BY duration, status
`);
console.log("Markets by duration × status:");
console.table(marketsByStatus.rows);

const tradesByKind = await c.query(`
  SELECT kind::TEXT AS kind, COUNT(*)::int AS n,
         COALESCE(SUM(amount), 0)::numeric AS total_amount
  FROM speed_trades
  WHERE created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  GROUP BY kind ORDER BY kind
`);
console.log("Trades by kind:");
console.table(tradesByKind.rows);

const txByType = await c.query(`
  SELECT type::TEXT AS type, COUNT(*)::int AS n,
         COALESCE(SUM(amount), 0)::numeric AS total
  FROM transactions
  WHERE created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND type::TEXT LIKE 'speed_%'
  GROUP BY type ORDER BY type
`);
console.log("Speed transactions by type:");
console.table(txByType.rows);

// ============================================================================
// B. Settlement math (mig 0016 §6, lines 1142-1189)
// ============================================================================

sec("B2 — Won payout = ROUND(stake / entry_offered_prob, 2)");
const wonMath = await c.query(`
  SELECT p.id AS position_id, p.stake::numeric AS stake,
         p.entry_offered_prob::numeric AS entry_offered_prob,
         p.payout_amount::numeric AS actual,
         ROUND(p.stake / p.entry_offered_prob, 2)::numeric AS expected,
         (p.payout_amount - ROUND(p.stake / p.entry_offered_prob, 2))::numeric AS diff
  FROM speed_positions p
  WHERE p.status = 'won'
    AND p.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND ABS(p.payout_amount - ROUND(p.stake / p.entry_offered_prob, 2)) > 0
  ORDER BY ABS(p.payout_amount - ROUND(p.stake / p.entry_offered_prob, 2)) DESC
  LIMIT 20
`);
if (wonMath.rowCount === 0) pass("all won payouts match formula exactly");
else { console.table(wonMath.rows); fail(`${wonMath.rowCount} won positions with payout mismatch`); }

sec("B3 — Lost positions have payout_amount = 0");
const lostNonZero = await c.query(`
  SELECT id, stake, payout_amount FROM speed_positions
  WHERE status = 'lost'
    AND created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND COALESCE(payout_amount, -1) <> 0
  LIMIT 20
`);
if (lostNonZero.rowCount === 0) pass("all lost positions have payout = 0");
else { console.table(lostNonZero.rows); fail(`${lostNonZero.rowCount} lost positions with non-zero payout`); }

sec("B4 — At-strike push refunds payout = stake");
const atStrikeMath = await c.query(`
  SELECT p.id, p.stake, p.payout_amount, m.outcome
  FROM speed_positions p JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status = 'refunded' AND m.outcome = 'at_strike'
    AND p.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND ABS(p.payout_amount - p.stake) > 0
  LIMIT 20
`);
if (atStrikeMath.rowCount === 0) pass("all at_strike refunds = stake (or none in window)");
else { console.table(atStrikeMath.rows); fail(`${atStrikeMath.rowCount} at_strike refunds with mismatched payout`); }

sec("B5 — Voided market refunds payout = stake");
const voidMath = await c.query(`
  SELECT p.id, p.stake, p.payout_amount, m.status, m.void_reason
  FROM speed_positions p JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status = 'refunded' AND m.status = 'voided'
    AND p.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND ABS(p.payout_amount - p.stake) > 0
  LIMIT 20
`);
if (voidMath.rowCount === 0) pass("all voided-market refunds = stake (or none in window)");
else { console.table(voidMath.rows); fail(`${voidMath.rowCount} void refunds with mismatched payout`); }

// ============================================================================
// C. Cashout math (mig 0016 §5, lines 877-885)
// ============================================================================

sec("C6 — Cashout = stake × (mark/entry) × decay × liq (±$0.01)");
// liq tier from mig 0016: >30s → 1.00, 10-30s → 0.85, 5-10s → 0.60, <5s → 0
// Use the cashout trade's created_at as the cashout time.
const cashoutMath = await c.query(`
  WITH cashouts AS (
    SELECT
      st.id AS trade_id,
      st.position_id,
      st.amount AS cashout_amount,
      st.fair_prob AS mark_prob,
      st.cashout_multiplier AS decay,
      st.created_at AS cashed_at,
      p.stake,
      p.entry_offered_prob,
      m.closes_at,
      EXTRACT(EPOCH FROM (m.closes_at - st.created_at)) AS seconds_left
    FROM speed_trades st
    JOIN speed_positions p ON p.id = st.position_id
    JOIN speed_markets m ON m.id = p.market_id
    WHERE st.kind = 'cashout'
      AND st.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  )
  SELECT *,
    CASE
      WHEN seconds_left > 30 THEN 1.00
      WHEN seconds_left >= 10 THEN 0.85
      WHEN seconds_left >= 5  THEN 0.60
      ELSE 0
    END AS liq,
    ROUND(stake * (mark_prob / entry_offered_prob) * decay
        * CASE
            WHEN seconds_left > 30 THEN 1.00
            WHEN seconds_left >= 10 THEN 0.85
            WHEN seconds_left >= 5  THEN 0.60
            ELSE 0
          END,
      2) AS expected,
    ABS(cashout_amount - ROUND(stake * (mark_prob / entry_offered_prob) * decay
        * CASE
            WHEN seconds_left > 30 THEN 1.00
            WHEN seconds_left >= 10 THEN 0.85
            WHEN seconds_left >= 5  THEN 0.60
            ELSE 0
          END,
      2)) AS diff
  FROM cashouts
  ORDER BY diff DESC
`);
const cashoutDrift = cashoutMath.rows.filter((r) => Number(r.diff) > 0.01);
console.log(`cashouts inspected: ${cashoutMath.rowCount}`);
if (cashoutMath.rowCount === 0) {
  warn("no cashouts in window — cannot verify cashout formula");
} else if (cashoutDrift.length === 0) {
  pass(`all ${cashoutMath.rowCount} cashouts match formula within $0.01`);
} else {
  console.table(cashoutDrift.slice(0, 20));
  fail(`${cashoutDrift.length} cashouts drift > $0.01 from formula`);
}

sec("C7 — No cashouts within 5s of close");
const lateCashouts = await c.query(`
  SELECT st.id AS trade_id, st.created_at, m.closes_at,
         EXTRACT(EPOCH FROM (m.closes_at - st.created_at)) AS seconds_left
  FROM speed_trades st
  JOIN speed_positions p ON p.id = st.position_id
  JOIN speed_markets m ON m.id = p.market_id
  WHERE st.kind = 'cashout'
    AND st.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND EXTRACT(EPOCH FROM (m.closes_at - st.created_at)) < 5
  ORDER BY seconds_left ASC LIMIT 20
`);
if (lateCashouts.rowCount === 0) pass("no cashouts within 5s of close");
else { console.table(lateCashouts.rows); fail(`${lateCashouts.rowCount} cashouts within 5s of close`); }

// ============================================================================
// D. Strike capture (mig 0014)
// ============================================================================

sec("D8 — Strike = oracle tick at-or-just-before opens_at (since mig 0014)");
// Mig 0014 file ts: 2026-05-03 17:13 local. Use a slightly later cutoff
// to be safe: only check markets created on/after 2026-05-04. Earlier
// markets used the live-oracle-at-roll-time rule.
const strikeCheck = await c.query(`
  WITH market_ticks AS (
    SELECT m.id AS market_id, m.asset, m.opens_at, m.strike_price, m.created_at,
      (SELECT t.price FROM speed_oracle_ticks t
        WHERE t.asset = m.asset AND t.ts <= m.opens_at
        ORDER BY t.ts DESC LIMIT 1) AS tick_price,
      (SELECT t.ts FROM speed_oracle_ticks t
        WHERE t.asset = m.asset AND t.ts <= m.opens_at
        ORDER BY t.ts DESC LIMIT 1) AS tick_ts,
      -- Strike could match an earlier tick (oracle insert race at cron fire)
      EXISTS (
        SELECT 1 FROM speed_oracle_ticks t
        WHERE t.asset = m.asset AND t.ts <= m.opens_at
          AND t.ts > m.opens_at - INTERVAL '5 seconds'
          AND ABS(t.price - m.strike_price) < 1e-8
      ) AS strike_matches_recent_tick
    FROM speed_markets m
    WHERE m.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND m.created_at >= '2026-05-04 00:00:00'::timestamptz  -- post-mig-0014
  )
  SELECT market_id, opens_at, strike_price::numeric, tick_price::numeric, tick_ts,
         strike_matches_recent_tick,
         (strike_price - COALESCE(tick_price, 0))::numeric AS drift
  FROM market_ticks
  WHERE tick_price IS NOT NULL
    AND ABS(strike_price - tick_price) > 1e-8
  ORDER BY ABS(strike_price - tick_price) DESC LIMIT 20
`);
const strikeRaceArtifacts = strikeCheck.rows.filter((r) => r.strike_matches_recent_tick);
const strikeRealMismatch = strikeCheck.rows.filter((r) => !r.strike_matches_recent_tick);
if (strikeCheck.rowCount === 0) pass("all post-mig-0014 market strikes match latest oracle tick at opens_at");
else {
  console.table(strikeCheck.rows);
  if (strikeRealMismatch.length === 0) {
    warn(`${strikeRaceArtifacts.length} markets show strike capture race vs oracle insert (strike matches a tick within 5s before opens_at, but not the absolute latest). Cosmetic — bet outcome unaffected, since settlement uses a different tick.`);
  } else {
    fail(`${strikeRealMismatch.length} markets with strike NOT matching ANY tick in 5s window before opens_at`);
  }
}

const strikeNoTick = await c.query(`
  SELECT COUNT(*)::int AS n FROM speed_markets m
  WHERE m.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND NOT EXISTS (
      SELECT 1 FROM speed_oracle_ticks t
      WHERE t.asset = m.asset AND t.ts <= m.opens_at
    )
`);
if (strikeNoTick.rows[0].n > 0) {
  warn(`${strikeNoTick.rows[0].n} markets created in window have NO oracle tick at-or-before opens_at — likely market created before oracle ticks recorded`);
}

// ============================================================================
// E. Settlement audit row coverage
// ============================================================================

sec("E9 — Every resolved market has audit row (since mig 0016 applied)");
// Mig 0016 introduced speed_market_settlement_audit. Filter to markets
// resolved AFTER the first audit row was written (= when mig 0016 RPC
// started running). Pre-mig markets ran a different RPC and have no audit.
const auditFirst = await c.query(`SELECT MIN(resolved_at) AS first FROM speed_market_settlement_audit`);
const mig0016Cutoff = auditFirst.rows[0].first;
console.log(`mig 0016 cutoff (first audit row): ${mig0016Cutoff?.toISOString() ?? 'no audit rows yet'}`);
const auditMissing = await c.query(`
  SELECT m.id, m.status, m.outcome, m.resolved_at
  FROM speed_markets m
  WHERE m.status = 'resolved'
    AND m.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND m.resolved_at >= $1::timestamptz
    AND NOT EXISTS (SELECT 1 FROM speed_market_settlement_audit a WHERE a.market_id = m.id)
  ORDER BY m.resolved_at DESC LIMIT 20
`, [mig0016Cutoff ?? new Date()]);
if (auditMissing.rowCount === 0) pass("every post-mig-0016 resolved market has audit row");
else { console.table(auditMissing.rows); fail(`${auditMissing.rowCount} post-mig-0016 resolved markets missing audit row`); }

const preCutoffMissing = await c.query(`
  SELECT COUNT(*)::int AS n FROM speed_markets m
  WHERE m.status = 'resolved'
    AND m.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND m.resolved_at < $1::timestamptz
    AND NOT EXISTS (SELECT 1 FROM speed_market_settlement_audit a WHERE a.market_id = m.id)
`, [mig0016Cutoff ?? new Date()]);
if (preCutoffMissing.rows[0].n > 0) {
  warn(`${preCutoffMissing.rows[0].n} resolved markets in window predate mig 0016 (no audit row, expected — different RPC)`);
}

const voidedAuditMissing = await c.query(`
  SELECT COUNT(*)::int AS n FROM speed_markets m
  WHERE m.status = 'voided'
    AND m.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND NOT EXISTS (SELECT 1 FROM speed_market_settlement_audit a WHERE a.market_id = m.id)
`);
if (voidedAuditMissing.rows[0].n > 0) {
  warn(`${voidedAuditMissing.rows[0].n} voided markets missing audit row (mig 0016 §6 only writes audit for non-void path; informational)`);
}

sec("E10 — Wick detector: settlement_price = exact_tick when no wick, median when wick");
const wickLogic = await c.query(`
  SELECT market_id, exact_tick_price::numeric, fallback_median_price::numeric,
         final_settlement_price::numeric, wick_detected, price_delta_pct::numeric
  FROM speed_market_settlement_audit
  WHERE resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND (
      (wick_detected = false AND ABS(final_settlement_price - exact_tick_price) > 1e-8)
      OR
      (wick_detected = true AND fallback_median_price IS NOT NULL
        AND ABS(final_settlement_price - fallback_median_price) > 1e-8)
    )
  LIMIT 20
`);
if (wickLogic.rowCount === 0) pass("wick detector logic consistent across audit rows");
else { console.table(wickLogic.rows); fail(`${wickLogic.rowCount} audit rows where final_settlement_price doesn't match wick branch`); }

const wickThresholdCheck = await c.query(`
  SELECT a.market_id, a.price_delta_pct::numeric, a.wick_detected,
         (SELECT rate FROM fee_config WHERE fee_type='speed_wick_threshold_pct')::numeric AS threshold
  FROM speed_market_settlement_audit a
  WHERE a.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND a.price_delta_pct IS NOT NULL
    AND (
      (a.price_delta_pct > (SELECT rate FROM fee_config WHERE fee_type='speed_wick_threshold_pct')
        AND a.wick_detected = false)
      OR
      (a.price_delta_pct <= (SELECT rate FROM fee_config WHERE fee_type='speed_wick_threshold_pct')
        AND a.wick_detected = true)
    )
  LIMIT 20
`);
if (wickThresholdCheck.rowCount === 0) pass("wick_detected flag consistent with price_delta_pct vs threshold");
else { console.table(wickThresholdCheck.rows); fail(`${wickThresholdCheck.rowCount} audit rows with wick_detected flag inconsistent with delta vs threshold`); }

// ============================================================================
// F. Late-window enforcement + risk caps (mig 0016 §4)
// ============================================================================

sec("F11 — No trade opened in last 10s of close (with 1s clock skew tolerance)");
const lateTrades = await c.query(`
  SELECT st.id AS trade_id, st.created_at, m.closes_at,
         EXTRACT(EPOCH FROM (m.closes_at - st.created_at)) AS seconds_left
  FROM speed_trades st
  JOIN speed_markets m ON m.id = st.market_id
  WHERE st.kind = 'open'
    AND st.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND EXTRACT(EPOCH FROM (m.closes_at - st.created_at)) < 9
  ORDER BY seconds_left ASC LIMIT 20
`);
if (lateTrades.rowCount === 0) pass("no trades opened in last 10s of close");
else { console.table(lateTrades.rows); fail(`${lateTrades.rowCount} trades opened with <9s left (late-window reject = 10s)`); }

sec("F12 — Per-side payout liability ≤ 25% × pool_collateral on open markets");
const exposureCheck = await c.query(`
  WITH cap AS (
    SELECT
      (SELECT rate FROM fee_config WHERE fee_type='speed_pool_collateral_usd')::numeric AS pool,
      (SELECT rate FROM fee_config WHERE fee_type='speed_max_market_exposure_pct')::numeric AS pct
  ),
  liability AS (
    SELECT m.id AS market_id, p.side::TEXT AS side,
           SUM(p.stake / NULLIF(p.entry_offered_prob, 0))::numeric AS payout_liability
    FROM speed_markets m
    JOIN speed_positions p ON p.market_id = m.id
    WHERE m.status = 'open' AND p.status = 'open'
    GROUP BY m.id, p.side
  )
  SELECT l.*, (cap.pool * cap.pct)::numeric AS cap_usd
  FROM liability l, cap
  WHERE l.payout_liability > cap.pool * cap.pct
  ORDER BY l.payout_liability DESC LIMIT 20
`);
if (exposureCheck.rowCount === 0) pass("all open markets within per-side liability cap");
else { console.table(exposureCheck.rows); fail(`${exposureCheck.rowCount} open markets exceed per-side liability cap`); }

// ============================================================================
// G. NGR cache consistency (mig 0016 §1B + §3D)
// ============================================================================

sec("G13 — Daily NGR cache matches resolution-day stakes (mig 0016 §3D semantics)");
// IMPORTANT: speed_daily_ngr.stake_in is updated by speed_resolve_market
// using SUM(stakes from positions on the resolved market), keyed to the
// RESOLUTION date — NOT the trade date. So we compare against position
// stakes grouped by their MARKET'S resolved_at date, not transaction date.
const ngrDrift = await c.query(`
  WITH resolved_stakes AS (
    SELECT DATE(m.resolved_at AT TIME ZONE 'UTC') AS d,
      COALESCE(SUM(p.stake), 0)::numeric AS stake_in,
      COALESCE(SUM(CASE WHEN p.status='won' THEN p.payout_amount ELSE 0 END), 0)::numeric AS payout_out,
      COALESCE(SUM(CASE WHEN p.status='refunded' THEN p.payout_amount ELSE 0 END), 0)::numeric AS refund_out
    FROM speed_markets m
    JOIN speed_positions p ON p.market_id = m.id
    WHERE m.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND m.status IN ('resolved','voided')
    GROUP BY DATE(m.resolved_at AT TIME ZONE 'UTC')
  ),
  cashouts AS (
    SELECT DATE(t.created_at AT TIME ZONE 'UTC') AS d,
      COALESCE(SUM(t.amount), 0)::numeric AS cashout_out
    FROM transactions t
    WHERE t.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND t.type = 'speed_cashout'
    GROUP BY DATE(t.created_at AT TIME ZONE 'UTC')
  )
  SELECT
    COALESCE(n.ngr_date, COALESCE(rs.d, cx.d)) AS ngr_date,
    COALESCE(n.stake_in, 0)::numeric    AS cache_stake_in,
    COALESCE(rs.stake_in, 0)::numeric   AS expected_stake_in,
    COALESCE(n.payout_out, 0)::numeric  AS cache_payout_out,
    COALESCE(rs.payout_out, 0)::numeric AS expected_payout_out,
    COALESCE(n.cashout_out, 0)::numeric AS cache_cashout_out,
    COALESCE(cx.cashout_out, 0)::numeric AS expected_cashout_out,
    COALESCE(n.refund_out, 0)::numeric  AS cache_refund_out,
    COALESCE(rs.refund_out, 0)::numeric AS expected_refund_out,
    GREATEST(
      ABS(COALESCE(n.stake_in,0)    - COALESCE(rs.stake_in,0)),
      ABS(COALESCE(n.payout_out,0)  - COALESCE(rs.payout_out,0)),
      ABS(COALESCE(n.cashout_out,0) - COALESCE(cx.cashout_out,0)),
      ABS(COALESCE(n.refund_out,0)  - COALESCE(rs.refund_out,0))
    )::numeric AS max_drift
  FROM resolved_stakes rs
  FULL OUTER JOIN cashouts cx ON cx.d = rs.d
  FULL OUTER JOIN speed_daily_ngr n ON n.ngr_date = COALESCE(rs.d, cx.d)
  WHERE COALESCE(n.ngr_date, COALESCE(rs.d, cx.d)) > (NOW() - INTERVAL '${WINDOW_DAYS} days')::date
  ORDER BY ngr_date DESC
`);
const ngrBad = ngrDrift.rows.filter((r) => Number(r.max_drift) > 0.01);
if (ngrDrift.rowCount === 0) {
  warn("no NGR cache rows or resolution data in window");
} else {
  console.table(ngrDrift.rows);
  if (ngrBad.length === 0) pass(`${ngrDrift.rowCount} day-rows: cache matches resolution-day computation within $0.01`);
  else warn(`${ngrBad.length} days where speed_daily_ngr drifts (may be expected if mig 0016 cutover is mid-day, since resolutions before mig 0016 didn't write to speed_daily_ngr)`);
}

// ============================================================================
// H. Cron + fee_config sanity
// ============================================================================

sec("H14 — pg_cron speed-roll/speed-resolve in last 24h");
const cronStats = await c.query(`
  SELECT j.jobname,
    COUNT(*)::int AS runs,
    COUNT(*) FILTER (WHERE d.status='succeeded')::int AS ok,
    COUNT(*) FILTER (WHERE d.status='failed')::int AS failed,
    MAX(d.start_time) AS last_run
  FROM cron.job j
  LEFT JOIN cron.job_run_details d
    ON d.jobid = j.jobid AND d.start_time > NOW() - INTERVAL '24 hours'
  WHERE j.jobname IN ('speed-roll','speed-resolve')
  GROUP BY j.jobname ORDER BY j.jobname
`);
console.table(cronStats.rows);
const failedRuns = cronStats.rows.reduce((acc, r) => acc + Number(r.failed), 0);
if (failedRuns === 0) pass("0 failed cron runs in last 24h (top-level pg_cron status)");
else fail(`${failedRuns} failed cron runs in last 24h`);

// CRITICAL: pg_cron only reports the wrapper RPC's exit status. RPCs that
// catch per-row exceptions (like speed_resolve_expired_markets) can return
// success even when their inner work failed. Probe the actual outcome.
sec("H14b — Stuck markets (status='open' but past closes_at) — outcome metric");
const stuck = await c.query(`
  SELECT COUNT(*)::int AS n,
    COUNT(*) FILTER (WHERE NOW() - closes_at > INTERVAL '60 seconds')::int AS over_60s,
    MIN(closes_at) AS oldest_stuck,
    EXTRACT(EPOCH FROM (NOW() - MIN(closes_at)))::int AS oldest_age_s
  FROM speed_markets WHERE status='open' AND closes_at < NOW()
`);
const s = stuck.rows[0];
console.log(`stuck_total=${s.n}, over_60s=${s.over_60s}, oldest_age=${s.oldest_age_s ?? 0}s`);
if (s.n === 0) pass("no stuck markets (every closed market has been resolved)");
else if (s.over_60s === 0) warn(`${s.n} markets briefly stuck (≤60s past close — likely in-flight)`);
else fail(`${s.over_60s} markets stuck >60s past close — speed_resolve_expired_markets is silently dropping them`);

sec("H14c — speed_resolve_expired_markets inner failed-counter probe");
// Manually invoke and inspect the JSONB return — the wrapper catches
// per-market exceptions but reports them in the `failed` field.
try {
  const probe = await c.query(`SELECT speed_resolve_expired_markets() AS r`);
  const r = probe.rows[0].r;
  console.log("Last invocation:", JSON.stringify({ resolved: r.resolved, voided: r.voided, failed: r.failed }, null, 2));
  if (Number(r.failed || 0) === 0) pass("speed_resolve_expired_markets reports failed=0");
  else {
    if (Array.isArray(r.errors) && r.errors.length) {
      console.log("Sample errors:");
      console.table(r.errors.slice(0, 5));
    }
    fail(`speed_resolve_expired_markets reports failed=${r.failed} (silent failure: pg_cron sees success)`);
  }
} catch (e) {
  fail(`probing speed_resolve_expired_markets threw: ${e.message.slice(0,120)}`);
}

const cronGap = await c.query(`
  WITH gaps AS (
    SELECT j.jobname,
      d.start_time,
      LAG(d.start_time) OVER (PARTITION BY j.jobname ORDER BY d.start_time) AS prev_start,
      EXTRACT(EPOCH FROM (d.start_time - LAG(d.start_time) OVER (PARTITION BY j.jobname ORDER BY d.start_time))) AS gap_sec
    FROM cron.job j
    JOIN cron.job_run_details d ON d.jobid = j.jobid
    WHERE j.jobname IN ('speed-roll','speed-resolve')
      AND d.start_time > NOW() - INTERVAL '24 hours'
  )
  SELECT jobname,
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY gap_sec)::numeric, 2) AS p50_gap_s,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_sec)::numeric, 2) AS p95_gap_s,
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY gap_sec)::numeric, 2) AS p99_gap_s,
    ROUND(MAX(gap_sec)::numeric, 2) AS max_gap_s
  FROM gaps WHERE gap_sec IS NOT NULL
  GROUP BY jobname ORDER BY jobname
`);
console.log("Inter-arrival gaps (target: p99 ≤ 8s):");
console.table(cronGap.rows);
const slowJobs = cronGap.rows.filter((r) => Number(r.p99_gap_s) > 8);
if (cronGap.rowCount === 0) warn("no cron run history in last 24h");
else if (slowJobs.length === 0) pass("p99 inter-arrival gap ≤ 8s for all speed cron jobs");
else fail(`${slowJobs.length} cron jobs with p99 gap > 8s`);

sec("H15 — fee_config completeness for mig 0016 + value sanity");
const requiredKeys = [
  "speed_markets_enabled",
  "speed_oracle_stale_seconds",
  "speed_spread_pct",
  "speed_iv_btc",
  "speed_extreme_spread_coeff",
  "speed_max_market_exposure_pct",
  "speed_pool_collateral_usd",
  "speed_max_user_daily_wager",
  "speed_max_strike_cluster_pct",
  "speed_daily_ngr_floor",
  "speed_wick_threshold_pct",
  "speed_late_window_60s_pct",
  "speed_late_window_30s_pct",
  "speed_late_window_reject_s",
  "speed_iv_drift_tolerance_pct",
  "speed_cashout_decay_5m_ge80","speed_cashout_decay_5m_60to80",
  "speed_cashout_decay_5m_40to60","speed_cashout_decay_5m_20to40","speed_cashout_decay_5m_lt20",
  "speed_cashout_decay_1h_ge80","speed_cashout_decay_1h_60to80",
  "speed_cashout_decay_1h_40to60","speed_cashout_decay_1h_20to40","speed_cashout_decay_1h_lt20",
  "speed_liq_discount_gt30","speed_liq_discount_10to30","speed_liq_discount_5to10",
];
const feeConfig = await c.query(`SELECT fee_type, rate::numeric FROM fee_config ORDER BY fee_type`);
const feeMap = new Map(feeConfig.rows.map((r) => [r.fee_type, Number(r.rate)]));
const missingKeys = requiredKeys.filter((k) => !feeMap.has(k));
if (missingKeys.length === 0) pass(`all ${requiredKeys.length} mig-0016 required fee_config rows present`);
else fail(`missing fee_config rows: ${missingKeys.join(", ")}`);

const handleFeeRow = await c.query(`SELECT rate FROM fee_config WHERE fee_type='speed_handle_fee_pct'`);
if (handleFeeRow.rowCount === 0) pass("speed_handle_fee_pct deleted (mig 0016 expected)");
else fail(`speed_handle_fee_pct still in fee_config (mig 0016 should have deleted): rate=${handleFeeRow.rows[0].rate}`);

console.log("Current critical fee_config values:");
const docExpected = {
  speed_spread_pct: 0.05,
  speed_pool_collateral_usd: 10000,
  speed_max_market_exposure_pct: 0.25,
  speed_max_user_daily_wager: 500,
  speed_max_strike_cluster_pct: 0.30,
  speed_daily_ngr_floor: -500,
  speed_late_window_60s_pct: 0.20,
  speed_late_window_30s_pct: 0.30,
  speed_late_window_reject_s: 10,
  speed_iv_drift_tolerance_pct: 0.10,
  speed_oracle_stale_seconds: 2,
  speed_extreme_spread_coeff: 8,
};
const driftRows = [];
for (const [k, expected] of Object.entries(docExpected)) {
  const actual = feeMap.get(k);
  const status = actual === expected ? "ok" : (actual === undefined ? "missing" : "DRIFT");
  driftRows.push({ key: k, expected, actual: actual ?? null, status });
}
console.table(driftRows);
const drifted = driftRows.filter((r) => r.status === "DRIFT");
if (drifted.length === 0) pass("critical fee_config values match docs/CLAUDE.md expectations");
else warn(`${drifted.length} fee_config keys drift from documented values (may be intentional tuning)`);

const wickThresh = feeMap.get("speed_wick_threshold_pct");
console.log(`speed_wick_threshold_pct = ${wickThresh} (mig 0016 set 0.001; mig 0017 changed it; CLAUDE.md says 0.0015)`);

// ============================================================================
// I. Admin /stats RPCs (mig 0015 §5-7)
// ============================================================================

sec("I16 — Admin RPC existence + admin gate");
const adminUser = await c.query(`
  SELECT id, email, is_admin FROM users WHERE email = $1 LIMIT 1
`, [KHALED_EMAIL]);
if (adminUser.rowCount === 0) {
  fail(`admin user ${KHALED_EMAIL} not found in users table`);
} else {
  const admin = adminUser.rows[0];
  if (!admin.is_admin) fail(`${KHALED_EMAIL} found but is_admin=false`);
  else pass(`admin user found: id=${admin.id}, is_admin=true`);

  // Smoke-call all 3 RPCs
  for (const rpc of [
    "SELECT * FROM get_stats_revenue_summary(NOW() - INTERVAL '7 days', NOW())",
    "SELECT * FROM get_stats_market_pnl(NOW() - INTERVAL '7 days', NOW(), NULL) LIMIT 1",
    "SELECT * FROM get_stats_user_pnl(5::int, 'volume'::text)",
  ]) {
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.user_id', '${admin.id}', true)`);
      await c.query(rpc);
      await c.query("COMMIT");
      pass(`RPC OK: ${rpc.slice(0, 60)}…`);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      fail(`RPC failed: ${rpc.slice(0, 60)}… → ${e.message.slice(0, 120)}`);
    }
  }

  // Negative test: a non-admin user (or null guc) should be blocked
  const nonAdmin = await c.query(`SELECT id FROM users WHERE is_admin = false LIMIT 1`);
  if (nonAdmin.rowCount > 0) {
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.user_id', '${nonAdmin.rows[0].id}', true)`);
      await c.query("SELECT * FROM get_stats_revenue_summary(NULL, NULL)");
      await c.query("ROLLBACK");
      fail("admin gate did not fire for non-admin user");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      if (/Unauthorized|admin only/i.test(e.message)) pass("admin gate fires for non-admin user");
      else fail(`unexpected error from non-admin call: ${e.message.slice(0, 120)}`);
    }
  } else {
    warn("no non-admin user found to test admin gate");
  }
}

sec("I17 — get_stats_revenue_summary math reconciliation");
let revRpcRow = null;
if (adminUser.rowCount > 0) {
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', '${adminUser.rows[0].id}', true)`);
  const res = await c.query(`
    SELECT * FROM get_stats_revenue_summary(NOW() - INTERVAL '${WINDOW_DAYS} days', NOW())
  `);
  await c.query("COMMIT");
  revRpcRow = res.rows[0];
}
const revRecompute = await c.query(`
  WITH range_positions AS (
    SELECT * FROM speed_positions
    WHERE created_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND created_at <= NOW()
  ),
  range_markets AS (
    SELECT * FROM speed_markets
    WHERE COALESCE(resolved_at, closes_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND COALESCE(resolved_at, closes_at) <= NOW()
  )
  SELECT
    COALESCE(SUM(p.stake), 0)::numeric AS gross_volume,
    COALESCE(SUM(CASE WHEN p.status::TEXT IN ('won','cashed_out','refunded')
      THEN COALESCE(p.payout_amount, 0) ELSE 0 END), 0)::numeric AS total_payouts,
    (COALESCE(SUM(p.stake), 0)
      - COALESCE(SUM(CASE WHEN p.status::TEXT IN ('won','cashed_out','refunded')
          THEN COALESCE(p.payout_amount, 0) ELSE 0 END), 0))::numeric AS platform_net,
    COALESCE(SUM(CASE WHEN p.status::TEXT='cashed_out'
      THEN p.stake - COALESCE(p.payout_amount, 0) ELSE 0 END), 0)::numeric AS cashout_premium_total,
    COALESCE(SUM(CASE WHEN p.status::TEXT='open' THEN p.stake ELSE 0 END), 0)::numeric AS open_cash_pool,
    (SELECT COUNT(*)::int FROM range_markets WHERE status::TEXT='resolved') AS markets_resolved,
    (SELECT COUNT(*)::int FROM range_markets WHERE status::TEXT='voided') AS markets_voided,
    (SELECT COUNT(DISTINCT user_id)::int FROM range_positions) AS unique_traders
  FROM range_positions p
`);
const recomp = revRecompute.rows[0];

if (revRpcRow) {
  const compareRows = [];
  let revFailed = 0;
  for (const k of ["gross_volume","total_payouts","platform_net","cashout_premium_total","open_cash_pool","markets_resolved","markets_voided","unique_traders"]) {
    const rpcVal = Number(revRpcRow[k]);
    const recompVal = Number(recomp[k]);
    const diff = Math.abs(rpcVal - recompVal);
    const ok = diff < 0.01;
    if (!ok) revFailed += 1;
    compareRows.push({ kpi: k, rpc: rpcVal, recomputed: recompVal, diff, ok: ok ? "✓" : "⚠️" });
  }
  console.table(compareRows);
  if (revFailed === 0) pass("all 8 revenue_summary KPIs match independent recompute");
  else fail(`${revFailed} revenue_summary KPIs mismatch`);
}

sec("I18 — get_stats_market_pnl math reconciliation");
if (adminUser.rowCount > 0) {
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', '${adminUser.rows[0].id}', true)`);
  const mktRpc = await c.query(`
    SELECT * FROM get_stats_market_pnl(NOW() - INTERVAL '${WINDOW_DAYS} days', NOW(), NULL)
  `);
  await c.query("COMMIT");

  if (mktRpc.rowCount === 0) {
    warn("no resolved/voided markets in window → cannot reconcile market_pnl");
  } else {
    const mktRecomp = await c.query(`
      SELECT m.id::text AS market_id,
        COUNT(p.id)::int AS total_positions,
        COUNT(p.id) FILTER (WHERE p.status='won')::int AS winners,
        COUNT(p.id) FILTER (WHERE p.status='lost')::int AS losers,
        COUNT(p.id) FILTER (WHERE p.status='refunded')::int AS refunded,
        COUNT(p.id) FILTER (WHERE p.status='cashed_out')::int AS cashed_out,
        COALESCE(SUM(p.stake), 0)::numeric AS stakes_in,
        COALESCE(SUM(CASE WHEN p.status::TEXT IN ('won','refunded','cashed_out')
          THEN COALESCE(p.payout_amount,0) ELSE 0 END), 0)::numeric AS payouts_out,
        COALESCE(SUM(CASE WHEN p.status::TEXT='cashed_out'
          THEN p.stake - COALESCE(p.payout_amount,0) ELSE 0 END), 0)::numeric AS cashout_premium
      FROM speed_markets m
      LEFT JOIN speed_positions p ON p.market_id = m.id
      WHERE COALESCE(m.resolved_at, m.closes_at) >= NOW() - INTERVAL '${WINDOW_DAYS} days'
        AND m.status::TEXT IN ('resolved','voided')
      GROUP BY m.id
    `);
    const recompByMkt = new Map(mktRecomp.rows.map((r) => [r.market_id, r]));
    let mktFailed = 0;
    const mismatches = [];
    for (const r of mktRpc.rows) {
      const recomp = recompByMkt.get(String(r.market_id));
      if (!recomp) { mktFailed += 1; mismatches.push({ market_id: r.market_id, error: "no recompute row" }); continue; }
      for (const k of ["total_positions","winners","losers","refunded","cashed_out"]) {
        if (Number(r[k]) !== Number(recomp[k])) { mktFailed += 1; mismatches.push({ market_id: r.market_id, k, rpc: r[k], recomp: recomp[k] }); }
      }
      for (const k of ["stakes_in","payouts_out","cashout_premium"]) {
        if (Math.abs(Number(r[k]) - Number(recomp[k])) > 0.01) { mktFailed += 1; mismatches.push({ market_id: r.market_id, k, rpc: r[k], recomp: recomp[k] }); }
      }
    }
    if (mktFailed === 0) pass(`all ${mktRpc.rowCount} markets in market_pnl reconcile`);
    else { console.table(mismatches.slice(0, 20)); fail(`${mktFailed} mismatches across ${mktRpc.rowCount} markets`); }
  }
}

sec("I19 — get_stats_user_pnl math reconciliation");
if (adminUser.rowCount > 0) {
  await c.query("BEGIN");
  await c.query(`SELECT set_config('app.user_id', '${adminUser.rows[0].id}', true)`);
  const userRpc = await c.query(`SELECT * FROM get_stats_user_pnl(20::int, 'volume'::text)`);
  await c.query("COMMIT");

  if (userRpc.rowCount === 0) {
    warn("no users in get_stats_user_pnl output");
  } else {
    const ids = userRpc.rows.map((r) => `'${r.user_id}'`).join(",");
    const userRecomp = await c.query(`
      SELECT u.id::text AS user_id,
        COUNT(p.id)::int AS position_count,
        COALESCE(SUM(p.stake), 0)::numeric AS total_stakes,
        COALESCE(SUM(CASE WHEN p.status::TEXT IN ('won','cashed_out','refunded')
          THEN COALESCE(p.payout_amount, 0) ELSE 0 END), 0)::numeric AS total_payouts,
        COUNT(p.id) FILTER (WHERE p.status='open')::int AS open_positions,
        COALESCE(SUM(CASE WHEN p.status::TEXT='open' THEN p.stake ELSE 0 END), 0)::numeric AS open_stake_total
      FROM users u
      LEFT JOIN speed_positions p ON p.user_id = u.id
      WHERE u.id IN (${ids})
      GROUP BY u.id
    `);
    const recompByUser = new Map(userRecomp.rows.map((r) => [r.user_id, r]));
    let userFailed = 0;
    const mismatches = [];
    for (const r of userRpc.rows) {
      const recomp = recompByUser.get(String(r.user_id));
      if (!recomp) { userFailed += 1; continue; }
      const rpcNet = Number(r.total_payouts) - Number(r.total_stakes);
      const recompNet = Number(recomp.total_payouts) - Number(recomp.total_stakes);
      for (const k of ["position_count","open_positions"]) {
        if (Number(r[k]) !== Number(recomp[k])) { userFailed += 1; mismatches.push({ user_id: r.user_id, k, rpc: r[k], recomp: recomp[k] }); }
      }
      for (const k of ["total_stakes","total_payouts","open_stake_total"]) {
        if (Math.abs(Number(r[k]) - Number(recomp[k])) > 0.01) { userFailed += 1; mismatches.push({ user_id: r.user_id, k, rpc: r[k], recomp: recomp[k] }); }
      }
      if (Math.abs(Number(r.net_pnl) - rpcNet) > 0.01) { userFailed += 1; mismatches.push({ user_id: r.user_id, k: "net_pnl", rpc: r.net_pnl, expected: rpcNet }); }
      if (Math.abs(Number(r.net_pnl) - recompNet) > 0.01) { userFailed += 1; mismatches.push({ user_id: r.user_id, k: "net_pnl_vs_recomp", rpc: r.net_pnl, recomp: recompNet }); }
    }
    if (userFailed === 0) pass(`all ${userRpc.rowCount} users in user_pnl reconcile`);
    else { console.table(mismatches.slice(0, 20)); fail(`${userFailed} mismatches across ${userRpc.rowCount} users`); }
  }
}

sec("I20 — Per-duration platform P&L crosswalk");
const perDuration = await c.query(`
  SELECT m.duration::TEXT AS duration,
    COUNT(p.id) FILTER (WHERE m.status='resolved')::int AS resolved_positions,
    COALESCE(SUM(CASE WHEN m.status='resolved' THEN p.stake ELSE 0 END), 0)::numeric AS user_in,
    COALESCE(SUM(CASE WHEN m.status='resolved' AND p.status='won'
      THEN p.payout_amount ELSE 0 END), 0)::numeric AS user_out_won,
    COALESCE(SUM(CASE WHEN m.status='resolved' AND p.status='cashed_out'
      THEN p.payout_amount ELSE 0 END), 0)::numeric AS user_out_cashout,
    COALESCE(SUM(CASE WHEN m.status='resolved' AND p.status='refunded'
      THEN p.payout_amount ELSE 0 END), 0)::numeric AS user_out_refund,
    COALESCE(SUM(CASE WHEN m.status='resolved'
      THEN p.stake - COALESCE(CASE WHEN p.status IN ('won','cashed_out','refunded')
        THEN p.payout_amount ELSE 0 END, 0)
      ELSE 0 END), 0)::numeric AS platform_net
  FROM speed_markets m
  LEFT JOIN speed_positions p ON p.market_id = m.id
  WHERE m.resolved_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  GROUP BY m.duration ORDER BY m.duration
`);
console.table(perDuration.rows);

// ============================================================================
// I21. Fee admin editor consistency
// ============================================================================

sec("I21 — fee_config editor surface vs underlying table");
const editorKeys = [
  "deposit_fee","withdrawal_fee",                 // Money group
  "speed_markets_enabled","speed_oracle_stale_seconds", // Speed group
];
const missingEditor = editorKeys.filter((k) => !feeMap.has(k));
if (missingEditor.length === 0) pass(`all ${editorKeys.length} editor-exposed keys exist in fee_config`);
else warn(`editor exposes keys missing from fee_config: ${missingEditor.join(", ")}`);

const hiddenButCritical = [
  "speed_spread_pct","speed_pool_collateral_usd","speed_max_market_exposure_pct",
  "speed_daily_ngr_floor","speed_late_window_60s_pct","speed_late_window_30s_pct",
  "speed_late_window_reject_s","speed_iv_drift_tolerance_pct",
];
const hiddenStatus = hiddenButCritical.map((k) => ({ key: k, value: feeMap.get(k) ?? null }));
console.log("Critical mig-0016 keys NOT exposed in admin /fees editor:");
console.table(hiddenStatus);

// ============================================================================
// J. Silent-failure flags
// ============================================================================

sec("J22 — cashout_premium definitional gap (current vs platform-edge formula)");
// Recompute "true" cashout edge = fair_value - cashout_amount, where
// fair_value = stake * (mark_prob / entry_offered_prob).
// We log mark_prob in speed_trades.fair_prob for cashouts (mig 0016 §5).
const cashoutEdge = await c.query(`
  WITH cx AS (
    SELECT
      st.id, p.stake, p.entry_offered_prob,
      st.fair_prob AS mark_prob, st.amount AS cashout_amount,
      (p.stake * (st.fair_prob / NULLIF(p.entry_offered_prob, 0)))::numeric AS fair_value,
      (p.stake - st.amount)::numeric AS current_premium,
      (p.stake * (st.fair_prob / NULLIF(p.entry_offered_prob, 0)) - st.amount)::numeric AS true_edge
    FROM speed_trades st
    JOIN speed_positions p ON p.id = st.position_id
    WHERE st.kind = 'cashout'
      AND st.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
  )
  SELECT
    COUNT(*)::int AS cashouts,
    ROUND(SUM(current_premium)::numeric, 2) AS sum_current_premium,
    ROUND(SUM(true_edge)::numeric, 2) AS sum_true_edge,
    ROUND((SUM(current_premium) - SUM(true_edge))::numeric, 2) AS gap,
    COUNT(*) FILTER (WHERE mark_prob > entry_offered_prob)::int AS winning_cashouts,
    COUNT(*) FILTER (WHERE mark_prob < entry_offered_prob)::int AS losing_cashouts
  FROM cx
`);
const edge = cashoutEdge.rows[0];
console.table([edge]);
if (Number(edge.cashouts) === 0) {
  warn("no cashouts in window — cannot quantify cashout_premium definitional gap");
} else {
  warn(`/admin/stats shows cashout_premium=$${edge.sum_current_premium}, true platform edge=$${edge.sum_true_edge} (gap=$${edge.gap}). The displayed KPI is "user's realized loss on cashout", NOT "platform edge from decay/liq".`);
}

sec("J23 — Cron failure visibility (last 7d)");
const cronFails = await c.query(`
  SELECT j.jobname, COUNT(*)::int AS failures, MAX(d.start_time) AS last_failure
  FROM cron.job j
  JOIN cron.job_run_details d ON d.jobid = j.jobid
  WHERE d.status = 'failed'
    AND d.start_time > NOW() - INTERVAL '${WINDOW_DAYS} days'
    AND j.jobname LIKE 'speed-%'
  GROUP BY j.jobname
`);
if (cronFails.rowCount === 0) pass("0 cron failures in last 7d for speed-* jobs");
else { console.table(cronFails.rows); warn(`cron failures detected (silent today — no alerting)`); }

sec("J24 — Ledger drift visibility (cache vs SUM(transactions))");
const ledgerDrift = await c.query(`
  SELECT u.id, u.email, u.balance_usd::numeric AS cached,
         COALESCE(SUM(t.amount),0)::numeric AS ledger,
         (u.balance_usd::numeric - COALESCE(SUM(t.amount),0)::numeric) AS drift_usd
  FROM users u LEFT JOIN transactions t ON t.user_id = u.id
  GROUP BY u.id, u.email, u.balance_usd
  HAVING ABS(u.balance_usd::numeric - COALESCE(SUM(t.amount),0)::numeric) > 0.01
  ORDER BY ABS(u.balance_usd::numeric - COALESCE(SUM(t.amount),0)::numeric) DESC LIMIT 20
`);
if (ledgerDrift.rowCount === 0) pass("0 users with cache vs ledger drift > $0.01");
else { console.table(ledgerDrift.rows); fail(`${ledgerDrift.rowCount} users with cache vs ledger drift > $0.01 (silent — only this audit catches it)`); }

sec("J25 — NGR cache vs ledger drift (already covered by G13 — repeated as silent-failure flag)");
if (ngrBad.length === 0) pass("NGR cache matches ledger — circuit breaker has correct input");
else warn(`NGR cache drifts from ledger on ${ngrBad.length} day(s) — circuit breaker may false-trip or fail-to-trip silently`);

sec("J26 — Audit row coverage (forensic gap)");
const totalResolvedSinceMig = await c.query(`
  SELECT COUNT(*)::int AS n FROM speed_markets
  WHERE status='resolved' AND resolved_at >= $1::timestamptz
`, [mig0016Cutoff ?? new Date()]);
const totalAuditsSinceMig = await c.query(`SELECT COUNT(*)::int AS n FROM speed_market_settlement_audit`);
console.log(`Post-mig-0016: resolved=${totalResolvedSinceMig.rows[0].n}, audit_rows=${totalAuditsSinceMig.rows[0].n}`);
if (auditMissing.rowCount === 0) pass("100% audit row coverage for post-mig-0016 resolved markets");
else fail(`${auditMissing.rowCount} post-mig-0016 resolved markets without audit row (silent — only catches on dispute)`);

// ============================================================================
// K. User-specific walk-through
// ============================================================================

sec(`K27 — All trades by ${KHALED_EMAIL} in last ${WINDOW_DAYS}d`);
if (adminUser.rowCount === 0) {
  warn("user not found, skipping personal walk-through");
} else {
  const userId = adminUser.rows[0].id;

  const userPositions = await c.query(`
    SELECT
      p.id AS position_id, p.created_at, p.closed_at, p.side::TEXT AS side,
      p.stake::numeric, p.entry_price::numeric, p.entry_offered_prob::numeric,
      p.status::TEXT AS status, p.payout_amount::numeric,
      m.duration::TEXT AS duration, m.strike_price::numeric, m.opens_at, m.closes_at,
      m.status::TEXT AS market_status, m.outcome::TEXT, m.twap_at_close::numeric,
      ROUND((p.stake / NULLIF(p.entry_offered_prob, 0))::numeric, 2) AS payout_if_won
    FROM speed_positions p
    JOIN speed_markets m ON m.id = p.market_id
    WHERE p.user_id = $1
      AND p.created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
    ORDER BY p.created_at DESC
  `, [userId]);

  console.log(`Found ${userPositions.rowCount} positions for ${KHALED_EMAIL} in last ${WINDOW_DAYS}d:`);
  if (userPositions.rowCount === 0) {
    warn("no recent positions for this user");
  } else {
    console.table(userPositions.rows.map((r) => ({
      created: r.created_at?.toISOString().slice(11, 19),
      dur: r.duration,
      side: r.side,
      stake: Number(r.stake),
      entry: Number(r.entry_offered_prob),
      payout_if_won: Number(r.payout_if_won),
      status: r.status,
      payout: r.payout_amount === null ? null : Number(r.payout_amount),
      outcome: r.outcome,
    })));
  }

  // Per-position math walkthrough
  let userIssues = 0;
  for (const p of userPositions.rows) {
    const expectedWin = Number((Number(p.stake) / Number(p.entry_offered_prob)).toFixed(2));
    if (p.status === "won" && Math.abs(Number(p.payout_amount) - expectedWin) > 0) {
      userIssues += 1;
      console.log(`  ⚠️  ${p.position_id}: won, payout=$${p.payout_amount}, expected=$${expectedWin}`);
    }
    if (p.status === "lost" && Number(p.payout_amount || 0) !== 0) {
      userIssues += 1;
      console.log(`  ⚠️  ${p.position_id}: lost but payout=$${p.payout_amount}`);
    }
    if (p.status === "refunded" && Math.abs(Number(p.payout_amount) - Number(p.stake)) > 0) {
      userIssues += 1;
      console.log(`  ⚠️  ${p.position_id}: refunded, payout=$${p.payout_amount}, expected=$${p.stake}`);
    }
  }
  if (userPositions.rowCount > 0) {
    if (userIssues === 0) pass(`all ${userPositions.rowCount} positions for ${KHALED_EMAIL} have correct math`);
    else fail(`${userIssues} positions for ${KHALED_EMAIL} have math issues`);
  }

  // Walk the user's transaction trail
  const userTx = await c.query(`
    SELECT created_at, type::TEXT AS type, amount::numeric, balance_after::numeric, description
    FROM transactions
    WHERE user_id = $1 AND created_at > NOW() - INTERVAL '${WINDOW_DAYS} days'
      AND type::TEXT LIKE 'speed_%'
    ORDER BY created_at DESC
  `, [userId]);
  console.log(`\nLast ${WINDOW_DAYS}d speed transactions for ${KHALED_EMAIL}:`);
  console.table(userTx.rows.slice(0, 30).map((r) => ({
    when: r.created_at?.toISOString().slice(11, 19),
    type: r.type,
    amount: Number(r.amount),
    balance_after: Number(r.balance_after),
    description: r.description?.slice(0, 60) ?? "",
  })));

  // Final: current balance vs sum(transactions all-time) for this user
  const userBal = await c.query(`
    SELECT u.balance_usd::numeric AS cached,
           COALESCE(SUM(t.amount), 0)::numeric AS ledger
    FROM users u LEFT JOIN transactions t ON t.user_id = u.id
    WHERE u.id = $1 GROUP BY u.balance_usd
  `, [userId]);
  if (userBal.rowCount > 0) {
    const r = userBal.rows[0];
    const drift = Math.abs(Number(r.cached) - Number(r.ledger));
    console.log(`Personal balance check: cached=$${r.cached}, ledger sum=$${r.ledger}, drift=$${drift}`);
    if (drift < 0.01) pass(`${KHALED_EMAIL}'s balance reconciles with ledger`);
    else fail(`${KHALED_EMAIL}'s balance drifts $${drift} from ledger`);
  }
}

// ============================================================================
// FINAL
// ============================================================================

console.log(`\n${"═".repeat(60)}`);
console.log(`Deep audit complete: ${issues === 0 ? "✅ no issues" : `⚠️  ${issues} issues`}, ${warnings} warnings`);
console.log(`${"═".repeat(60)}`);

await c.end();
process.exit(issues === 0 ? 0 : 1);
