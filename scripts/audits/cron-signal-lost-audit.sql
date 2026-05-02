-- scripts/audits/cron-signal-lost-audit.sql
-- -----------------------------------------------------------
-- Action 4: historical audit for the cron alert signal-lost window.
-- -----------------------------------------------------------
--
-- The cron endpoint src/app/api/cron/check-errors/route.ts filtered
-- reconcile_branch_solvency() output using key `discrepancy` — a column
-- that never existed. The real columns are `difference` (worst-case cache
-- mismatch) and `pool_difference` (pool balance cache vs ledger mismatch).
-- Until the f7b198b fix landed, ANY branch solvency drift went unalerted.
--
-- This audit reconstructs what WOULD have been alerted in the lost window
-- by running reconcile_branch_solvency() now (which auto-corrects) and
-- comparing current state against historical branch_pools ledger deltas.
--
-- How to run on STAGING:
--   cat supabase/.temp/project-ref  # MUST show zzebptrztuwnqlxxmjuo
--   psql "$(supabase status | grep 'DB URL' | awk '{print $3}')" \
--     -f scripts/audits/cron-signal-lost-audit.sql
--
-- Save the output to docs/audits/2026-04-18-signal-lost.md for the record.

-- ─────────────────────────────────────────────────────────────
-- Section 1 — Current reconciliation state
-- ─────────────────────────────────────────────────────────────
-- Run reconcile (auto-corrects and returns the diff). Any non-zero
-- difference OR pool_difference is current drift — alert-worthy.

SELECT
  'CURRENT_RECONCILE' AS finding,
  branch_name,
  ROUND(difference, 2) AS worst_case_drift,
  ROUND(pool_difference, 2) AS pool_drift,
  ROUND(cached_worst_case, 2) AS cached_wc,
  ROUND(computed_worst_case, 2) AS computed_wc,
  ROUND(cached_pool_balance, 2) AS cached_pool,
  ROUND(ledger_pool_balance, 2) AS ledger_pool
FROM reconcile_branch_solvency()
WHERE ABS(difference) > 0.01
   OR ABS(pool_difference) > 0.01
ORDER BY GREATEST(ABS(difference), ABS(pool_difference)) DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 2 — system_logs rows previously missed by the cron filter
-- ─────────────────────────────────────────────────────────────
-- Prior to the fix, check-errors looked for unacknowledged ERROR/CRITICAL
-- entries from the last 10 minutes. Any branch_solvency_reconciliation
-- row with a non-trivial pool_difference SHOULD have fired a Slack alert,
-- but the filter key mismatch meant they were all skipped.

SELECT
  'MISSED_LOG' AS finding,
  created_at,
  severity,
  source,
  (context->>'branch_id')::UUID AS branch_id,
  ROUND((context->>'pool_difference')::numeric, 2) AS pool_diff_logged,
  ROUND((context->>'wc_difference')::numeric, 2) AS wc_diff_logged,
  acknowledged
FROM system_logs
WHERE source = 'branch_solvency_reconciliation'
  AND created_at > NOW() - INTERVAL '30 days'
  AND (
    ABS(COALESCE((context->>'pool_difference')::numeric, 0)) > 10
    OR ABS(COALESCE((context->>'wc_difference')::numeric, 0)) > 10
  )
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 3 — biggest lost-signal events
-- ─────────────────────────────────────────────────────────────
-- Top 20 most-severe reconcile events (by pool_difference magnitude)
-- that went unalerted. If any row here has pool_diff > $100, it
-- warrants a manual investigation of the underlying settlement.

WITH missed AS (
  SELECT
    created_at,
    (context->>'branch_id')::UUID AS branch_id,
    (context->>'pool_difference')::numeric AS pool_diff,
    (context->>'wc_difference')::numeric AS wc_diff,
    context
  FROM system_logs
  WHERE source = 'branch_solvency_reconciliation'
    AND created_at > NOW() - INTERVAL '60 days'
)
SELECT
  'TOP_LOST_SIGNAL' AS finding,
  m.created_at,
  b.name AS branch_name,
  ROUND(m.pool_diff, 2) AS pool_diff,
  ROUND(m.wc_diff, 2) AS wc_diff,
  m.context
FROM missed m
LEFT JOIN branches b ON b.id = m.branch_id
WHERE ABS(COALESCE(m.pool_diff, 0)) > 10
ORDER BY ABS(COALESCE(m.pool_diff, 0)) DESC
LIMIT 20;

-- ─────────────────────────────────────────────────────────────
-- Section 4 — W1-C audit cross-check
-- ─────────────────────────────────────────────────────────────
-- The commit message on f7b198b cited a $10K+ drift during the W1-C
-- audit that the broken filter swallowed. Find rows consistent with
-- that: large pool_diff in the audit time window. Adjust the date
-- range to cover your actual audit window.

SELECT
  'W1C_CANDIDATE' AS finding,
  created_at,
  (context->>'branch_id')::UUID AS branch_id,
  ROUND(COALESCE((context->>'pool_difference')::numeric, 0), 2) AS pool_diff,
  message
FROM system_logs
WHERE source = 'branch_solvency_reconciliation'
  AND ABS(COALESCE((context->>'pool_difference')::numeric, 0)) > 1000
ORDER BY ABS(COALESCE((context->>'pool_difference')::numeric, 0)) DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────
-- Section 5 — agent_balance reconciliation (newly wired in f7b198b)
-- ─────────────────────────────────────────────────────────────
-- The commit also wired reconcile_agent_balances() into the cron for
-- the first time. Function existed since mig 143 but was never called.
-- Run it now to surface any historical agent wallet drift.

SELECT
  'AGENT_BALANCE_DRIFT' AS finding,
  user_id,
  ROUND(cached_agent_balance, 2) AS cached,
  ROUND(computed_agent_balance, 2) AS computed,
  ROUND(difference, 2) AS drift
FROM reconcile_agent_balances()
WHERE ABS(difference) > 0.01
ORDER BY ABS(difference) DESC
LIMIT 50;

-- ─────────────────────────────────────────────────────────────
-- Section 6 — summary
-- ─────────────────────────────────────────────────────────────

SELECT
  'SUMMARY' AS finding,
  (SELECT COUNT(*) FROM system_logs
     WHERE source = 'branch_solvency_reconciliation'
       AND created_at > NOW() - INTERVAL '30 days'
       AND ABS(COALESCE((context->>'pool_difference')::numeric, 0)) > 10)
    AS missed_alerts_30d,
  (SELECT MAX(ABS(COALESCE((context->>'pool_difference')::numeric, 0))) FROM system_logs
     WHERE source = 'branch_solvency_reconciliation'
       AND created_at > NOW() - INTERVAL '30 days')
    AS max_missed_drift_usd_30d;
