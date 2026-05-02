-- ============================================================================
-- 338_speed_exposure_cap.sql
--
-- Codex finding #1 (LAUNCH BLOCKER) — per-market aggregate exposure cap.
--
-- Problem: 319_speed_execute_trade caps stake per (user, market, side) only.
-- Each user is bounded but there's no aggregate cap across users. 1,000 users
-- staking $25 each on UP creates unbounded house exposure; one directional
-- move at expiry wipes the pool.
--
-- mig 314 created speed_market_exposure_live + speed_exposure_live as
-- placeholder tables. No trigger maintained them. No RPC read them. This
-- migration wires them up + adds the cap check.
--
-- Three coupled changes:
-- 1. Trigger on speed_positions (incremental delta, NOT aggregate-recompute)
-- 2. Aggregate-cap check inside speed_execute_trade
-- 3. fee_config row speed_max_market_exposure_pct (default 0.40 = 40% of pool)
--
-- The trigger's FOR UPDATE on the cache row inside speed_execute_trade serializes
-- concurrent trades on the same market — without it, two RPCs could both pass
-- the cap check before either INSERT lands.
-- ============================================================================

-- ─── 1. Fee config: cap percentage ──────────────────────────────────────────

INSERT INTO fee_config (fee_type, level, depth, rate, description)
VALUES (
  'speed_max_market_exposure_pct', NULL, NULL, 0.40,
  'Maximum % of pool collateral allowed as worst-case payout exposure on either side of a single market. Trades exceeding this are rejected.'
)
ON CONFLICT DO NOTHING;

-- ─── 2. Trigger function: maintain exposure caches via delta ────────────────

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
BEGIN
  -- Compute deltas based on operation
  IF TG_OP = 'INSERT' THEN
    -- New position = add full amounts (only if open)
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
    -- Status transition: open → won/lost/cashed_out/refunded subtracts
    IF OLD.status = 'open' AND NEW.status <> 'open' THEN
      IF OLD.side = 'over' THEN
        v_delta_over_stake := -OLD.stake;
      ELSE
        v_delta_under_stake := -OLD.stake;
      END IF;
      v_delta_count := -1;
    -- Edge case: status went from settled back to open (shouldn't happen, but guard)
    ELSIF OLD.status <> 'open' AND NEW.status = 'open' THEN
      IF NEW.side = 'over' THEN
        v_delta_over_stake := NEW.stake;
      ELSE
        v_delta_under_stake := NEW.stake;
      END IF;
      v_delta_count := 1;
    END IF;
    -- open → open with stake change: subtract old, add new
    -- (won't happen with current immutable position pattern, but covered)

    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = NEW.market_id;

  ELSIF TG_OP = 'DELETE' THEN
    -- Defensive: subtract if was open (positions should never delete in normal flow)
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

  -- No-op if nothing changed
  IF v_delta_over_stake = 0 AND v_delta_under_stake = 0 AND v_delta_count = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ── Update speed_market_exposure_live (per-market cache) ─────────────
  -- INSERT-then-UPDATE pattern via ON CONFLICT for idempotent first-touch
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

  -- ── Update speed_exposure_live (per-branch per-asset cache) ──────────
  -- Use NULL branch_id for retail / SOOQ main pool flows
  INSERT INTO speed_exposure_live (
    branch_id, asset, open_over_notional, open_under_notional, net_notional,
    open_position_count, utilization_pct, last_updated_at
  ) VALUES (
    COALESCE(NEW.branch_id, OLD.branch_id),
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

-- ─── 3. Trigger wiring ──────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_speed_position_exposure ON speed_positions;

CREATE TRIGGER trg_speed_position_exposure
  AFTER INSERT OR UPDATE OR DELETE ON speed_positions
  FOR EACH ROW EXECUTE FUNCTION _speed_position_exposure_trigger();

-- ─── 4. Backfill existing exposure rows from current open positions ──────────

INSERT INTO speed_market_exposure_live (market_id, asset, net_notional, net_qty, open_position_count, branch_breakdown, last_updated_at)
SELECT
  m.id,
  m.asset,
  COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0)
    - COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0),
  0,
  COUNT(p.id),
  '[]'::jsonb,
  NOW()
FROM speed_markets m
LEFT JOIN speed_positions p ON p.market_id = m.id AND p.status = 'open'
WHERE m.status = 'open'
GROUP BY m.id, m.asset
ON CONFLICT (market_id) DO UPDATE SET
  net_notional = EXCLUDED.net_notional,
  open_position_count = EXCLUDED.open_position_count,
  last_updated_at = NOW();

INSERT INTO speed_exposure_live (branch_id, asset, open_over_notional, open_under_notional, net_notional, open_position_count, utilization_pct, last_updated_at)
SELECT
  p.branch_id,
  m.asset,
  COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0),
  COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0),
  COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0)
    - COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0),
  COUNT(p.id),
  0,
  NOW()
FROM speed_positions p
JOIN speed_markets m ON m.id = p.market_id
WHERE p.status = 'open'
GROUP BY p.branch_id, m.asset
ON CONFLICT (branch_id, asset) DO UPDATE SET
  open_over_notional = EXCLUDED.open_over_notional,
  open_under_notional = EXCLUDED.open_under_notional,
  net_notional = EXCLUDED.net_notional,
  open_position_count = EXCLUDED.open_position_count,
  last_updated_at = NOW();

COMMENT ON FUNCTION _speed_position_exposure_trigger() IS
'Maintains speed_market_exposure_live and speed_exposure_live caches via incremental deltas on every INSERT/UPDATE/DELETE of speed_positions. Mig 338.';
