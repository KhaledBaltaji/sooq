-- ============================================================================
-- 346_speed_exposure_trigger_retail_fix.sql
--
-- Pre-existing trigger bug surfaced by mig 345's concurrency test.
--
-- Problem:
--   _speed_position_exposure_trigger (mig 338) maintains two caches:
--     1. speed_market_exposure_live (per-market) — branch_id-agnostic
--     2. speed_exposure_live (per-branch, per-asset) — keyed on branch_id
--
--   The second table has `branch_id UUID NOT NULL REFERENCES branches(id)`
--   (mig 314), but the trigger code always tries to insert with
--   `COALESCE(NEW.branch_id, OLD.branch_id)` regardless of whether it's NULL.
--   Retail/main-pool trades have NEW.branch_id = NULL, so the INSERT raises:
--
--     null value in column "branch_id" of relation "speed_exposure_live"
--     violates not-null constraint
--
--   This means retail speed trades have never succeeded on staging. The bug
--   was masked because the project's tests didn't exercise the retail flow
--   end-to-end.
--
-- Fix:
--   Skip the speed_exposure_live INSERT when branch_id IS NULL. The
--   per-market cache (speed_market_exposure_live) still gets updated, and
--   that's what the per-market exposure cap in speed_execute_trade actually
--   reads. The per-branch cache only matters for branch-scoped UI/dashboards
--   which don't apply to the main pool anyway.
--
-- This restores `CREATE OR REPLACE FUNCTION _speed_position_exposure_trigger`
-- with one extra `IF` guarding the second INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION _speed_position_exposure_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market_asset speed_asset;
  v_delta_over_stake DECIMAL := 0;
  v_delta_under_stake DECIMAL := 0;
  v_delta_count INTEGER := 0;
  v_effective_branch_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'open' THEN
      IF NEW.side = 'over' THEN
        v_delta_over_stake := NEW.stake;
      ELSE
        v_delta_under_stake := NEW.stake;
      END IF;
      v_delta_count := 1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = NEW.market_id;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'open' AND NEW.status <> 'open' THEN
      IF OLD.side = 'over' THEN
        v_delta_over_stake := -OLD.stake;
      ELSE
        v_delta_under_stake := -OLD.stake;
      END IF;
      v_delta_count := -1;
    ELSIF OLD.status <> 'open' AND NEW.status = 'open' THEN
      IF NEW.side = 'over' THEN
        v_delta_over_stake := NEW.stake;
      ELSE
        v_delta_under_stake := NEW.stake;
      END IF;
      v_delta_count := 1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = NEW.market_id;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'open' THEN
      IF OLD.side = 'over' THEN
        v_delta_over_stake := -OLD.stake;
      ELSE
        v_delta_under_stake := -OLD.stake;
      END IF;
      v_delta_count := -1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = OLD.market_id;
  END IF;

  IF v_delta_over_stake = 0 AND v_delta_under_stake = 0 AND v_delta_count = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ── Per-market exposure cache (branch-agnostic) — always updated ──────
  INSERT INTO speed_market_exposure_live (
    market_id, asset, net_notional, net_qty, open_position_count, branch_breakdown, last_updated_at
  ) VALUES (
    COALESCE(NEW.market_id, OLD.market_id),
    v_market_asset,
    v_delta_over_stake - v_delta_under_stake,
    0,
    GREATEST(0, v_delta_count),
    '[]'::jsonb,
    NOW()
  )
  ON CONFLICT (market_id) DO UPDATE SET
    net_notional = speed_market_exposure_live.net_notional + (v_delta_over_stake - v_delta_under_stake),
    open_position_count = GREATEST(0, speed_market_exposure_live.open_position_count + v_delta_count),
    last_updated_at = NOW();

  -- ── Per-branch exposure cache — SKIP for retail (branch_id IS NULL) ───
  -- Mig 346 fix: speed_exposure_live.branch_id is NOT NULL with FK to
  -- branches(id), so the cache is per-reseller-branch only. Retail/main-pool
  -- flow doesn't have a branch, so there's nothing to record here. The
  -- per-market cache above is what the exposure-cap RPC actually reads.
  v_effective_branch_id := COALESCE(NEW.branch_id, OLD.branch_id);
  IF v_effective_branch_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO speed_exposure_live (
    branch_id, asset, open_over_notional, open_under_notional, net_notional,
    open_position_count, utilization_pct, last_updated_at
  ) VALUES (
    v_effective_branch_id,
    v_market_asset,
    GREATEST(0, v_delta_over_stake),
    GREATEST(0, v_delta_under_stake),
    v_delta_over_stake - v_delta_under_stake,
    GREATEST(0, v_delta_count),
    0,
    NOW()
  )
  ON CONFLICT (branch_id, asset) DO UPDATE SET
    open_over_notional = GREATEST(0, speed_exposure_live.open_over_notional + v_delta_over_stake),
    open_under_notional = GREATEST(0, speed_exposure_live.open_under_notional + v_delta_under_stake),
    net_notional = speed_exposure_live.net_notional + (v_delta_over_stake - v_delta_under_stake),
    open_position_count = GREATEST(0, speed_exposure_live.open_position_count + v_delta_count),
    last_updated_at = NOW();

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION _speed_position_exposure_trigger() IS
'Maintains speed_market_exposure_live and (for branched flows only) speed_exposure_live caches via incremental deltas on every INSERT/UPDATE/DELETE of speed_positions. Mig 346: skips the per-branch cache when branch_id IS NULL (retail / main-pool flow) — that table has branch_id NOT NULL FK and isn''t needed for retail tracking; the per-market cache covers the exposure-cap path.';
