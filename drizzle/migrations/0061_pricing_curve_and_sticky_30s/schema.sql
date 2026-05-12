-- ============================================================================
-- Migration 0061 — Pricing curve v4 + sticky last-30s + parity ±1 bucket
-- ============================================================================
--
-- Phase 5 of the predictability/trust framework (plan:
-- ~/.claude/plans/in-our-model-there-swirling-popcorn.md). Replaces the
-- linear "offered = fair + spread/2" pricing with a compression curve that
-- naturally approaches 1.0 / 0.0 at extremes, so the soft-block at 0.97
-- and hard rejects at fair > 0.97 / fair < 0.03 become unnecessary.
--
-- Curve math (locked in plan after telemetry confirmed):
--   half_spread = widened_spread / 2
--   upper side (mark >= 0.5):  offered = mark + min(half_spread, (1 - mark) * 0.5)
--   lower side (mark < 0.5):   offered = mark - min(half_spread, mark * 0.5)
--
-- Guarantees:
--   offered >= mark on upper side, offered <= mark on lower side (house edge >= 0)
--   offered -> 1 smoothly as mark -> 1 (no clamp surprise)
--   At mark = 0.5: offered = 0.5 + half_spread (matches current)
--
-- Why the soft-block can go: at mark = 0.97 with 5% spread,
--   offered = 0.97 + min(0.025, 0.015) = 0.985.
-- User stakes $200, wins $200/0.985 = $203.04, profit $3.04 on a 97% trade.
-- Expected value: 0.97 * 3.04 + 0.03 * -200 = -3.05. Negative EV.
-- The exploit dies on its own — no block needed.
--
-- Defense layers preserved:
--   - Late-window spread multipliers (1.2× @ 60s, 1.4× @ 30s) — keep
--   - CLV per-user shading (mig 0044) — keep, last layer
--   - Last 10 seconds: still hard-closed
--   - Per-side caps, velocity, exposure — unchanged
--   - Daily NGR breaker — unchanged
--
-- Three new behaviors gated by speed_use_new_curve (default 0 — OFF):
--   1. _speed_pricing_apply uses the new compression curve
--   2. speed_execute_trade drops soft-block + hard rejects (fair > 0.97, fair < 0.03)
--   3. speed_execute_trade implements sticky 30s on 5m markets only
--
-- Plus ALWAYS-ON (flag-independent) changes:
--   - Parity ±1 bucket tolerance on seconds_left_bucket (kills 30s/60s cliff)
--
-- Rollback: UPDATE fee_config SET rate = 0 WHERE fee_type = 'speed_use_new_curve';
-- That single statement reverts pricing behavior to mig 0034 mode. The new
-- late_block_fired column is harmless if the flag is off (it just stays
-- FALSE on all markets).
--
-- See silent failure audit in plan file for all 16 mitigations.

SET search_path = public;

-- ── Feature flag (default OFF for safety) ────────────────────────────────
-- Default 0: ship code with no user-visible behavior change. Admin flips
-- to 1 when ready. The COALESCE chain in _speed_pricing_apply uses
-- COALESCE(flag, 0) — NULL row = old behavior.
INSERT INTO fee_config (fee_type, rate, description)
VALUES (
  'speed_use_new_curve',
  0,
  '0061 Phase 5: enables the new compression pricing curve. 0=old behavior (linear spread + soft-block + hard rejects at 0.97/0.03). 1=new curve (offered tracks fair; soft-block + hard rejects skipped; sticky 30s on 5m). Default 0 until founder smoke-tests.'
)
ON CONFLICT (fee_type) DO NOTHING;

-- ── Sticky last-30s column ──────────────────────────────────────────────
-- Per-market boolean. Once set TRUE in the last 30s of a 5m market when
-- |fair - 0.5| > near_decided_dist, BOTH sides stay closed for the rest
-- of the round. Concurrent trades guarded by SELECT ... FOR UPDATE in
-- speed_execute_trade.
--
-- Always added (regardless of flag) so the column is available when the
-- flag flips. Default FALSE means it's a no-op on existing markets.
-- Resolution cron (speed_resolve_expired_markets) ignores the column —
-- resolved markets keep their existing settlement logic.
ALTER TABLE speed_markets
  ADD COLUMN IF NOT EXISTS late_block_fired BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN speed_markets.late_block_fired IS
  '0061 Phase 5: sticky last-30s gate. When TRUE, speed_execute_trade rejects all new bets on this market for the rest of the round (5m only). Set inside the trade RPC under FOR UPDATE so concurrent attempts can''t race past it.';

-- Sanity: flag exists, column exists
DO $$
DECLARE
  v_flag DECIMAL;
  v_col_count INT;
BEGIN
  SELECT rate INTO v_flag FROM fee_config WHERE fee_type = 'speed_use_new_curve';
  IF v_flag IS NULL THEN
    RAISE EXCEPTION 'Mig 0061: speed_use_new_curve flag not inserted';
  END IF;

  SELECT count(*) INTO v_col_count FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'speed_markets' AND column_name = 'late_block_fired';
  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'Mig 0061: late_block_fired column not added';
  END IF;

  RAISE NOTICE 'Mig 0061: schema ready. Flag=%, column exists. Apply function bodies next.', v_flag;
END $$;
