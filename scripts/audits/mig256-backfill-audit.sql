-- scripts/audits/mig256-backfill-audit.sql
-- -----------------------------------------------------------
-- Action 2: backfill audit for migration 256 ambiguous state.
-- -----------------------------------------------------------
--
-- Migration 231 failed silently on staging (ALTER TABLE branch_agents ADD
-- status/approved_at/rejection_reason never took effect). Migration 256
-- restored the schema, back-filling status from is_active — but left
-- several shapes of ambiguous state behind. Before relying on the
-- cumulative_pl gate in transfer_agent_to_portfolio we need to know which
-- rows look fishy.
--
-- How to run on STAGING:
--   1. cat supabase/.temp/project-ref  # MUST show zzebptrztuwnqlxxmjuo
--   2. psql "$(supabase status | grep 'DB URL' | awk '{print $3}')" \
--        -f scripts/audits/mig256-backfill-audit.sql
--   3. Review each section's output. Any row surfaced here is a candidate
--      for manual reconciliation before production replay.
--
-- How to run on PRODUCTION:
--   DO NOT link Claude Code to production. Run this from your local shell
--   against a prod-backed psql after you've personally verified the link.
--
-- ─────────────────────────────────────────────────────────────
-- Section 1 — status/approved_at inconsistency
-- ─────────────────────────────────────────────────────────────
-- Any row where status='approved' but approved_at IS NULL (or vice versa).
-- The mig 256 backfill set approved_at = now() for is_active=true rows; if
-- an agent was approved pre-231 and later deactivated, approved_at may
-- still be wrong.

SELECT
  'STATUS_APPROVED_AT_MISMATCH' AS finding,
  id AS agent_id,
  branch_id,
  user_id,
  status,
  is_active,
  approved_at,
  approved_by,
  created_at
FROM branch_agents
WHERE (status = 'approved' AND approved_at IS NULL)
   OR (status != 'approved' AND approved_at IS NOT NULL)
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 2 — is_active / status mismatch
-- ─────────────────────────────────────────────────────────────
-- The backfill assumed is_active=true → status='approved'. If the app ever
-- toggled is_active without going through the status flow, rows may
-- disagree.

SELECT
  'IS_ACTIVE_STATUS_MISMATCH' AS finding,
  id AS agent_id,
  branch_id,
  user_id,
  status,
  is_active,
  approved_at,
  rejection_reason
FROM branch_agents
WHERE (is_active = TRUE  AND status != 'approved')
   OR (is_active = FALSE AND status = 'approved');

-- ─────────────────────────────────────────────────────────────
-- Section 3 — cumulative_pl NULL (pre-mig 250 rows)
-- ─────────────────────────────────────────────────────────────
-- Agents created before migration 250 may have cumulative_pl IS NULL
-- instead of the default 0. transfer_agent_to_portfolio's negative-P/L
-- gate ignores NULL → agents can transfer with undefined P/L state.
-- Surface these so we can explicitly set cumulative_pl := 0.

SELECT
  'CUMULATIVE_PL_NULL' AS finding,
  ba.id AS agent_id,
  ba.branch_id,
  ba.user_id,
  ba.agent_type,
  ba.rate,
  ba.is_active,
  ba.created_at,
  (SELECT COUNT(*) FROM referral_commissions rc
     WHERE rc.branch_id = ba.branch_id
       AND rc.referrer_id = ba.user_id
       AND rc.source_type IN ('branch_commission', 'branch_pl')) AS commission_rows_count
FROM branch_agents ba
WHERE ba.cumulative_pl IS NULL
ORDER BY ba.created_at DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 4 — cumulative_pl ≠ SUM(referral_commissions)
-- ─────────────────────────────────────────────────────────────
-- The ledger source-of-truth is branch_pl commission rows. If the cached
-- cumulative_pl drifts from SUM(commission_amount WHERE source='branch_pl')
-- that's a reconciliation signal. Threshold $0.01 to ignore rounding.

WITH ledger AS (
  SELECT
    ba.id AS agent_id,
    COALESCE(SUM(rc.commission_amount) FILTER (WHERE rc.source_type = 'branch_pl'), 0) AS ledger_pl
  FROM branch_agents ba
  LEFT JOIN referral_commissions rc
    ON rc.branch_id = ba.branch_id
   AND rc.referrer_id = ba.user_id
  GROUP BY ba.id
)
SELECT
  'CUMULATIVE_PL_LEDGER_DRIFT' AS finding,
  ba.id AS agent_id,
  ba.branch_id,
  ba.user_id,
  ba.agent_type,
  ba.cumulative_pl,
  l.ledger_pl,
  (ba.cumulative_pl - l.ledger_pl) AS drift
FROM branch_agents ba
JOIN ledger l ON l.agent_id = ba.id
WHERE ABS(COALESCE(ba.cumulative_pl, 0) - l.ledger_pl) > 0.01
ORDER BY ABS(COALESCE(ba.cumulative_pl, 0) - l.ledger_pl) DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 5 — agent_type NULL on active agents
-- ─────────────────────────────────────────────────────────────
-- mig 256 made agent_type nullable. Any is_active=TRUE row with agent_type
-- NULL would crash downstream RPCs. Should be zero on a clean system.

SELECT
  'AGENT_TYPE_NULL_ACTIVE' AS finding,
  id AS agent_id,
  branch_id,
  user_id,
  is_active,
  status,
  rate
FROM branch_agents
WHERE is_active = TRUE
  AND agent_type IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Section 6 — rate NULL or out-of-range on active agents
-- ─────────────────────────────────────────────────────────────

SELECT
  'RATE_INVALID_ACTIVE' AS finding,
  id AS agent_id,
  branch_id,
  user_id,
  agent_type,
  rate,
  is_active,
  status
FROM branch_agents
WHERE is_active = TRUE
  AND (rate IS NULL OR rate <= 0 OR rate > 1.0);

-- ─────────────────────────────────────────────────────────────
-- Section 7 — 80% cap violations on active P/L agents
-- ─────────────────────────────────────────────────────────────
-- Migration 268 adds a trigger to enforce the cap going forward. Pre-existing
-- branches might already exceed. Surface them so we can make a call: leave
-- grandfathered or force-rebalance.

WITH pl_sums AS (
  SELECT
    branch_id,
    SUM(rate) FILTER (WHERE is_active = TRUE AND agent_type = 'pl') AS active_pl_sum
  FROM branch_agents
  GROUP BY branch_id
)
SELECT
  'PL_CAP_EXCEEDED' AS finding,
  b.id AS branch_id,
  b.name AS branch_name,
  ps.active_pl_sum,
  (SELECT rate FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum' LIMIT 1) AS cap
FROM branches b
JOIN pl_sums ps ON ps.branch_id = b.id
WHERE ps.active_pl_sum > COALESCE(
  (SELECT rate FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum' LIMIT 1),
  0.80
)
ORDER BY ps.active_pl_sum DESC;

-- ─────────────────────────────────────────────────────────────
-- Section 8 — summary counts
-- ─────────────────────────────────────────────────────────────

SELECT 'SUMMARY' AS section,
       (SELECT COUNT(*) FROM branch_agents) AS total_agents,
       (SELECT COUNT(*) FROM branch_agents WHERE status = 'approved' AND approved_at IS NULL)
         AS status_approved_at_mismatches,
       (SELECT COUNT(*) FROM branch_agents WHERE cumulative_pl IS NULL) AS cumulative_pl_nulls,
       (SELECT COUNT(*) FROM branch_agents WHERE is_active = TRUE AND agent_type IS NULL)
         AS agent_type_null_active,
       (SELECT COUNT(*) FROM branch_agents WHERE is_active = TRUE
          AND (rate IS NULL OR rate <= 0 OR rate > 1.0)) AS rate_invalid_active;

-- ─────────────────────────────────────────────────────────────
-- Section 9 — suggested reconciliation statements
-- ─────────────────────────────────────────────────────────────
-- These are printed as SELECTs (not executed) so the operator can copy
-- them to a separate psql session after reviewing section 1-7 output.

SELECT
  'RECONCILE_CUMULATIVE_PL_NULL' AS suggested_action,
  'UPDATE branch_agents SET cumulative_pl = 0 WHERE id = ''' || id || ''';' AS statement
FROM branch_agents
WHERE cumulative_pl IS NULL
LIMIT 50;

SELECT
  'RECONCILE_APPROVED_AT_NULL' AS suggested_action,
  'UPDATE branch_agents SET approved_at = created_at WHERE id = ''' || id || ''';' AS statement
FROM branch_agents
WHERE status = 'approved' AND approved_at IS NULL
LIMIT 50;
