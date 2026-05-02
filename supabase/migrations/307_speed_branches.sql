-- ============================================================================
-- 307_speed_branches.sql
--
-- Sidecar table for reseller branches that opt into speed markets.
-- One row per branch with FK to branches(id). Holds collateral pool,
-- per-branch parameters, and freeze state.
--
-- Design notes:
-- - speed_pool_balance has NO CHECK >= 0. It can go negative; freeze rules
--   govern, not a hard constraint.
-- - All per-branch parameters are required at row creation (no defaults).
--   Admin sets them at the enable-speed-for-branch flow.
-- - stake_caps_per_side is a JSONB map keyed by duration:
--     {"5m": 200, "15m": 500, "1h": 1000, "24h": 2000}
--   Per-side cap = max total stake from one user on one side of one market.
-- - Commission branches do NOT need a row in this table. They earn via the
--   retail commission walk on user.referral_chain (Flow A) since variance
--   from their users' bets routes to SOOQ main pool.
-- ============================================================================

CREATE TABLE speed_branches (
  branch_id              UUID PRIMARY KEY REFERENCES branches(id) ON DELETE RESTRICT,
  speed_status           speed_branch_status NOT NULL DEFAULT 'inactive',
  speed_pool_balance     DECIMAL(18,2) NOT NULL DEFAULT 0,
  -- No CHECK >= 0. Pool can be negative; freeze + admin discretion handle insolvency.

  -- Branch fee share (% of platform handle fee on their users' speed bets)
  fee_share_pct          DECIMAL(5,4) NOT NULL,

  -- Freeze thresholds (per-branch, no global default)
  freeze_warn_pct        DECIMAL(5,4) NOT NULL,
  freeze_hard_pct        DECIMAL(5,4) NOT NULL,
  unfreeze_pct           DECIMAL(5,4) NOT NULL,

  -- Stake caps (per-bet)
  stake_min              DECIMAL(18,2) NOT NULL,
  stake_max              DECIMAL(18,2) NOT NULL,

  -- Per-side cap per market per duration (JSONB)
  -- Example: {"5m": 200, "15m": 500, "1h": 1000, "24h": 2000}
  stake_caps_per_side    JSONB NOT NULL,

  -- Lifecycle
  activated_at           TIMESTAMPTZ,
  activated_by           UUID REFERENCES users(id) ON DELETE RESTRICT,
  suspension_reason      TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT speed_thresholds_ordered CHECK (
    unfreeze_pct < freeze_warn_pct AND freeze_warn_pct < freeze_hard_pct
  ),
  CONSTRAINT speed_stake_range CHECK (stake_min < stake_max),
  CONSTRAINT speed_fee_share_range CHECK (fee_share_pct >= 0 AND fee_share_pct <= 1),
  CONSTRAINT speed_stake_caps_is_object CHECK (jsonb_typeof(stake_caps_per_side) = 'object')
);

CREATE INDEX idx_speed_branches_status ON speed_branches(speed_status)
  WHERE speed_status IN ('active', 'warning');

COMMENT ON TABLE speed_branches IS
'Sidecar table for reseller branches opting into speed markets. One row per branch. Commission branches do not have rows here — they earn via retail commission walk.';
COMMENT ON COLUMN speed_branches.speed_pool_balance IS
'Cumulative balance from all speed_pool_ledger entries. CAN BE NEGATIVE. Freeze rules govern, not a hard CHECK.';
COMMENT ON COLUMN speed_branches.stake_caps_per_side IS
'JSONB map of duration -> max total stake from one user on one side of one market. Set by admin at enable. Required.';
