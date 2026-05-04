-- 0016_speed_casino_mode.sql
--
-- Casino-mode pricing & cashout overhaul. Replaces the discrete-bucket cashout
-- formula with a continuous mark-to-market formula, restores aggressive
-- late-window protection on entries, adds multi-dimensional exposure caps,
-- adds a daily NGR circuit breaker, and replaces TWAP settlement with
-- exact-tick + wick-detector safety net.
--
-- Driving plan: ~/.claude/plans/check-the-pricing-logic-cozy-cocke.md
--
-- Behavioural changes:
--
--   1. Continuous cashout formula (kills the role-boundary $10→$5 cliff)
--      cashout = stake × (mark_prob / entry_offered_prob)
--                      × decay_curve(duration, pct)
--                      × liquidation_discount(seconds_left)
--      One formula. No winner/loser branch. Smooth across the role boundary.
--
--   2. Duration-specific decay curves stored as
--      `speed_cashout_decay_<duration>_<bucket>` fee_config rows. Old role-
--      based `speed_cashout_<duration>_<role>_<bucket>` rows (mig 0010 seeds)
--      are deleted.
--
--   3. Liquidation discount tiers: 1.0 (>30s), 0.85 (10–30s), 0.6 (5–10s).
--      <5s: cashout rejected entirely.
--
--   4. Phantom handle fee deleted entirely. Mig 0013 set the rate to 0; this
--      migration removes the row from fee_config. `speed_spread_pct` raised
--      0.04 → 0.05 to absorb the same effective edge with no separate "fee"
--      line item. The handle_fee column stays for historical (pre-0013) rows
--      but new trades store NULL.
--
--   5. Quadratic spread widening past ±0.45 from center on entries (Seam 3
--      from supabase mig 352, never ported to drizzle until now).
--
--   6. Three-tier late-window surcharge on entries:
--        last 60s → +20% spread
--        last 30s → +30% spread
--        last 10s → reject entry entirely
--
--   7. Multi-dimensional exposure caps:
--        per market per side: 25% of pool collateral
--        per user per market: $200 (existing — kept)
--        per user per day across all markets: $500 (NEW)
--        same-strike cluster across durations: 30% of pool (NEW)
--        daily platform NGR floor: -$500 (NEW circuit breaker)
--      Pool collateral via fee_config row `speed_pool_collateral_usd`
--      (default $10,000), tunable without redeploy.
--
--   8. Exact-tick settlement (NO TWAP) with wick detector:
--      Settlement uses the latest oracle tick at-or-before closes_at. If the
--      price moved >0.1% in the 5s before close (wick / manipulation), fall
--      back to median-of-last-30-ticks. All settlement metadata logged to a
--      new `speed_market_settlement_audit` table for disputes.
--
--   9. IV snapshot pattern (closes the quote/execute parity hole):
--      Trade and cashout RPCs accept optional `p_expected_iv`. If the server's
--      current IV drifts >10% from the client's snapshot, return IV_DRIFT
--      error so the UI can re-render. Otherwise, use the client's snapshot
--      and store it on `speed_trades.iv_used`.
--
--      Note: the current Drizzle DB doesn't have a realized-vol cache table.
--      `_speed_get_iv()` would always fall through to fee_config IV. Keeping
--      it inline here for clarity — when an RV worker is added later, the
--      lookup becomes a `_speed_get_iv()` helper call without changing call
--      sites.
--
--  10. Hard removal of 15m and 24h: trade and cashout reject any duration
--      not in ('5m','1h'). Production cleanup of stragglers is operational.
--
--  11. Daily NGR cache (`speed_daily_ngr` table) updated atomically inside
--      `speed_resolve_market` and `speed_execute_cashout`. Circuit breaker
--      reads from the cache (O(1) PK lookup) on every entry attempt.
--
-- Verification: see plan file. New tests deferred per founder direction.
-- Manual smoke checks listed in plan's Verification section.

BEGIN;

-- ============================================================================
-- 1) SCHEMA — new tables, columns, indexes
-- ============================================================================

-- ── 1A. Settlement audit trail (one row per resolved market) ────────────────
CREATE TABLE IF NOT EXISTS public.speed_market_settlement_audit (
  market_id              UUID PRIMARY KEY REFERENCES public.speed_markets(id) ON DELETE CASCADE,
  resolved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at              TIMESTAMPTZ NOT NULL,
  exact_tick_price       DECIMAL(18,8) NOT NULL,
  exact_tick_at          TIMESTAMPTZ NOT NULL,
  price_5s_before        DECIMAL(18,8),
  price_delta_pct        DECIMAL(10,8),
  wick_detected          BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_median_price  DECIMAL(18,8),
  fallback_tick_count    INTEGER,
  final_settlement_price DECIMAL(18,8) NOT NULL,
  raw_ticks              JSONB
);

CREATE INDEX IF NOT EXISTS speed_market_settlement_audit_resolved_at_idx
  ON public.speed_market_settlement_audit (resolved_at DESC);

COMMENT ON TABLE public.speed_market_settlement_audit IS
  '0016: per-market settlement audit. Captures exact-tick price, 5s-before price, wick detection result, and median fallback (if used). raw_ticks JSONB holds last 30 ticks for dispute reconstruction.';

-- ── 1B. Daily NGR cache (one row per UTC day) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.speed_daily_ngr (
  ngr_date           DATE PRIMARY KEY,
  stake_in           DECIMAL(18,2) NOT NULL DEFAULT 0,
  payout_out         DECIMAL(18,2) NOT NULL DEFAULT 0,
  cashout_out        DECIMAL(18,2) NOT NULL DEFAULT 0,
  refund_out         DECIMAL(18,2) NOT NULL DEFAULT 0,
  ngr                DECIMAL(18,2) GENERATED ALWAYS AS
                       (stake_in - payout_out - cashout_out - refund_out) STORED,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  circuit_tripped_at TIMESTAMPTZ
);

COMMENT ON TABLE public.speed_daily_ngr IS
  '0016: daily NGR cache. Updated atomically by speed_resolve_market + speed_execute_cashout. Read by speed_execute_trade for circuit-breaker check (O(1) PK lookup). Auto-resets daily because each day gets its own row.';

-- ── 1C. IV snapshot column on speed_trades ──────────────────────────────────
ALTER TABLE public.speed_trades
  ADD COLUMN IF NOT EXISTS iv_used DECIMAL(8,6);

COMMENT ON COLUMN public.speed_trades.iv_used IS
  '0016: IV value used to compute fair_prob for this trade. NULL for pre-0016 trades. Captured to prove quote/execute parity in disputes.';

COMMENT ON COLUMN public.speed_trades.handle_fee IS
  'Pre-0013 only had non-zero values; 0013-0015 wrote 0; post-0016 writes NULL. Spread now captures all house edge in a single number — no separate handle fee.';

-- ── 1D. Indexes for cap-check queries (live SUM aggregation strategy) ───────
CREATE INDEX IF NOT EXISTS speed_positions_market_status_side_idx
  ON public.speed_positions (market_id, status, side);

CREATE INDEX IF NOT EXISTS speed_positions_user_created_idx
  ON public.speed_positions (user_id, created_at DESC)
  WHERE status IN ('open','won','lost','cashed_out');

CREATE INDEX IF NOT EXISTS speed_markets_strike_status_idx
  ON public.speed_markets (strike_price, status)
  WHERE status = 'open';

-- ============================================================================
-- 2) FEE_CONFIG — delete obsolete, insert new tunables, update existing
-- ============================================================================

-- Drop the old role-based bucket multipliers (mig 0010 seeds). The new
-- continuous formula doesn't have a winner/loser branch.
DELETE FROM public.fee_config WHERE fee_type LIKE 'speed_cashout_%_winner_%';
DELETE FROM public.fee_config WHERE fee_type LIKE 'speed_cashout_%_loser_%';

-- Drop the phantom handle fee row (mig 0013 set rate to 0 — now removed).
DELETE FROM public.fee_config WHERE fee_type = 'speed_handle_fee_pct';

-- Raise base spread 0.04 → 0.05 (absorbs the former 1% handle fee).
UPDATE public.fee_config SET rate = 0.05, updated_at = NOW()
WHERE fee_type = 'speed_spread_pct';

-- Insert the new tunables.
INSERT INTO public.fee_config (fee_type, rate, description) VALUES
  -- Pool collateral (denominator for per-side and same-strike caps).
  ('speed_pool_collateral_usd', 10000,
    '0016: pool collateral in USD; denominator for per-side and same-strike exposure caps. Tune up as float grows.'),

  -- Per-side market exposure cap (existing was a hardcoded 40% in stripped
  -- mig 353; this restores the cap as a tunable, set to 25% per Codex).
  ('speed_max_market_exposure_pct', 0.25,
    '0016: per-market per-side exposure cap as fraction of pool collateral.'),

  -- Per-user daily wager cap across all markets.
  ('speed_max_user_daily_wager', 500,
    '0016: per-user daily wager cap across all markets ($).'),

  -- Same-strike cluster cap (correlated risk across durations).
  ('speed_max_strike_cluster_pct', 0.30,
    '0016: same-strike cluster cap as % of pool collateral. Cluster = markets within ±0.5% of strike.'),

  -- Daily NGR floor — circuit breaker.
  ('speed_daily_ngr_floor', -500,
    '0016: daily NGR floor in $. Halt new entries when settled NGR falls below this; cashouts and resolution still allowed; auto-reset at UTC midnight.'),

  -- Quadratic widening coefficient (Seam 3 from supabase mig 352).
  ('speed_extreme_spread_coeff', 8,
    '0016: coefficient on (distance-0.45)^2 quadratic widening of spread at extreme moneyness.'),

  -- Wick detector.
  ('speed_wick_threshold_pct', 0.001,
    '0016: settlement wick detector. If 5s price delta exceeds this %, fall back to median-of-30-ticks. Set to 0 to disable.'),

  -- Late-window surcharge tiers.
  ('speed_late_window_60s_pct', 0.20,
    '0016: spread surcharge added in last 60s of market.'),
  ('speed_late_window_30s_pct', 0.30,
    '0016: spread surcharge added in last 30s (replaces 60s tier).'),
  ('speed_late_window_reject_s', 10,
    '0016: seconds before close at which entries are rejected entirely.'),

  -- IV-snapshot drift tolerance for the quote/execute parity guarantee.
  ('speed_iv_drift_tolerance_pct', 0.10,
    '0016: max relative drift between client expected_iv and server IV before IV_DRIFT error.'),

  -- Continuous decay curve endpoints — duration-specific.
  ('speed_cashout_decay_5m_ge80', 0.95, '5m decay: pct >= 0.80'),
  ('speed_cashout_decay_5m_60to80', 0.85, '5m decay: 0.60 <= pct < 0.80'),
  ('speed_cashout_decay_5m_40to60', 0.70, '5m decay: 0.40 <= pct < 0.60'),
  ('speed_cashout_decay_5m_20to40', 0.50, '5m decay: 0.20 <= pct < 0.40'),
  ('speed_cashout_decay_5m_lt20', 0.30, '5m decay: pct < 0.20'),
  ('speed_cashout_decay_1h_ge80', 0.92, '1h decay: pct >= 0.80'),
  ('speed_cashout_decay_1h_60to80', 0.80, '1h decay: 0.60 <= pct < 0.80'),
  ('speed_cashout_decay_1h_40to60', 0.65, '1h decay: 0.40 <= pct < 0.60'),
  ('speed_cashout_decay_1h_20to40', 0.45, '1h decay: 0.20 <= pct < 0.40'),
  ('speed_cashout_decay_1h_lt20', 0.25, '1h decay: pct < 0.20'),

  -- Liquidation discount tiers (shared across durations).
  ('speed_liq_discount_gt30', 1.00, 'Liquidation discount: > 30s left'),
  ('speed_liq_discount_10to30', 0.85, 'Liquidation discount: 10-30s left'),
  ('speed_liq_discount_5to10', 0.60, 'Liquidation discount: 5-10s left')
ON CONFLICT (fee_type) DO UPDATE
  SET rate = EXCLUDED.rate, description = EXCLUDED.description, updated_at = NOW();

-- ============================================================================
-- 3) HELPER FUNCTIONS
-- ============================================================================

-- Drop any old (duration, role, pct) signature from supabase mig 351 if it
-- happens to exist in this DB; we use a (duration, pct) signature now.
DROP FUNCTION IF EXISTS public.speed_cashout_multiplier(public.speed_duration, TEXT, DOUBLE PRECISION);

-- ── 3A. Continuous cashout multiplier — duration-specific decay curve ───────
CREATE OR REPLACE FUNCTION public.speed_cashout_multiplier(
  p_duration public.speed_duration,
  p_pct      DOUBLE PRECISION
) RETURNS DECIMAL
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct      DOUBLE PRECISION;
  v_dur      TEXT;
  v_ge80     DECIMAL;
  v_60to80   DECIMAL;
  v_40to60   DECIMAL;
  v_20to40   DECIMAL;
  v_lt20     DECIMAL;
BEGIN
  IF p_duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Cashout multiplier not configured for duration %', p_duration;
  END IF;

  v_pct := GREATEST(0, LEAST(1, p_pct));
  v_dur := p_duration::TEXT;

  SELECT rate INTO v_ge80     FROM fee_config WHERE fee_type = 'speed_cashout_decay_' || v_dur || '_ge80';
  SELECT rate INTO v_60to80   FROM fee_config WHERE fee_type = 'speed_cashout_decay_' || v_dur || '_60to80';
  SELECT rate INTO v_40to60   FROM fee_config WHERE fee_type = 'speed_cashout_decay_' || v_dur || '_40to60';
  SELECT rate INTO v_20to40   FROM fee_config WHERE fee_type = 'speed_cashout_decay_' || v_dur || '_20to40';
  SELECT rate INTO v_lt20     FROM fee_config WHERE fee_type = 'speed_cashout_decay_' || v_dur || '_lt20';

  IF v_ge80 IS NULL OR v_60to80 IS NULL OR v_40to60 IS NULL
     OR v_20to40 IS NULL OR v_lt20 IS NULL THEN
    RAISE EXCEPTION 'Cashout decay curve incomplete for duration %', p_duration;
  END IF;

  -- Endpoints anchor the multiplier at five points: 0.00, 0.20, 0.40, 0.60,
  -- 0.80 (and flat above 0.80). Linear interp between adjacent endpoints, no
  -- cliffs. v_lt20 is the multiplier at pct=0; v_ge80 is the multiplier at
  -- pct>=0.80.
  IF v_pct >= 0.80 THEN
    RETURN v_ge80;
  ELSIF v_pct >= 0.60 THEN
    RETURN v_60to80 + (v_ge80   - v_60to80) * ((v_pct - 0.60) / 0.20);
  ELSIF v_pct >= 0.40 THEN
    RETURN v_40to60 + (v_60to80 - v_40to60) * ((v_pct - 0.40) / 0.20);
  ELSIF v_pct >= 0.20 THEN
    RETURN v_20to40 + (v_40to60 - v_20to40) * ((v_pct - 0.20) / 0.20);
  ELSE
    RETURN v_lt20   + (v_20to40 - v_lt20)   * (v_pct / 0.20);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.speed_cashout_multiplier(public.speed_duration, DOUBLE PRECISION) IS
  '0016: continuous duration-specific cashout decay curve. Linearly interpolates between five endpoints stored in fee_config (speed_cashout_decay_<dur>_<bucket>). Replaces the (duration, role, pct) signature from supabase mig 351 — winner/loser branching is gone in the new continuous formula.';

GRANT EXECUTE ON FUNCTION public.speed_cashout_multiplier(public.speed_duration, DOUBLE PRECISION)
  TO PUBLIC;

-- ── 3B. Liquidation discount (shared across durations) ──────────────────────
CREATE OR REPLACE FUNCTION public.speed_liq_discount(
  p_seconds_left DOUBLE PRECISION
) RETURNS DECIMAL
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gt30   DECIMAL;
  v_10to30 DECIMAL;
  v_5to10  DECIMAL;
BEGIN
  -- < 5s is also rejected at the call site; returning 0 is defense-in-depth.
  IF p_seconds_left < 5 THEN
    RETURN 0;
  END IF;

  SELECT rate INTO v_gt30   FROM fee_config WHERE fee_type = 'speed_liq_discount_gt30';
  SELECT rate INTO v_10to30 FROM fee_config WHERE fee_type = 'speed_liq_discount_10to30';
  SELECT rate INTO v_5to10  FROM fee_config WHERE fee_type = 'speed_liq_discount_5to10';
  v_gt30   := COALESCE(v_gt30,   1.00);
  v_10to30 := COALESCE(v_10to30, 0.85);
  v_5to10  := COALESCE(v_5to10,  0.60);

  IF p_seconds_left > 30 THEN
    RETURN v_gt30;
  ELSIF p_seconds_left >= 10 THEN
    RETURN v_10to30;
  ELSE
    RETURN v_5to10;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.speed_liq_discount(DOUBLE PRECISION) IS
  '0016: liquidation discount tier applied multiplicatively on top of the decay curve. Discrete tiers, sharp drops near expiry. < 5s returns 0 (defense-in-depth — RPC also rejects).';

GRANT EXECUTE ON FUNCTION public.speed_liq_discount(DOUBLE PRECISION)
  TO PUBLIC;

-- ── 3C. Three-tier late-window surcharge (entries) ──────────────────────────
CREATE OR REPLACE FUNCTION public.speed_late_window_surcharge_pct(
  p_seconds_left DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_30s DECIMAL;
  v_60s DECIMAL;
BEGIN
  SELECT rate INTO v_30s FROM fee_config WHERE fee_type = 'speed_late_window_30s_pct';
  SELECT rate INTO v_60s FROM fee_config WHERE fee_type = 'speed_late_window_60s_pct';
  v_30s := COALESCE(v_30s, 0.30);
  v_60s := COALESCE(v_60s, 0.20);

  IF p_seconds_left < 30 THEN
    RETURN v_30s::DOUBLE PRECISION;
  ELSIF p_seconds_left < 60 THEN
    RETURN v_60s::DOUBLE PRECISION;
  ELSE
    RETURN 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.speed_late_window_surcharge_pct(DOUBLE PRECISION) IS
  '0016: 3-tier late-window spread surcharge. Returns extra spread % to add to base spread (0 outside the late window). 60s window: +20%. 30s window: +30%. < 10s: handled at call site (RPC rejects).';

GRANT EXECUTE ON FUNCTION public.speed_late_window_surcharge_pct(DOUBLE PRECISION)
  TO PUBLIC;

-- ── 3D. Daily NGR upsert helper ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._speed_update_daily_ngr(
  p_stake_in    DECIMAL DEFAULT 0,
  p_payout_out  DECIMAL DEFAULT 0,
  p_cashout_out DECIMAL DEFAULT 0,
  p_refund_out  DECIMAL DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor          DECIMAL;
  v_new_ngr        DECIMAL;
  v_existing_trip  TIMESTAMPTZ;
BEGIN
  INSERT INTO speed_daily_ngr (
    ngr_date, stake_in, payout_out, cashout_out, refund_out, updated_at
  ) VALUES (
    CURRENT_DATE,
    COALESCE(p_stake_in, 0),
    COALESCE(p_payout_out, 0),
    COALESCE(p_cashout_out, 0),
    COALESCE(p_refund_out, 0),
    NOW()
  )
  ON CONFLICT (ngr_date) DO UPDATE
    SET stake_in    = speed_daily_ngr.stake_in    + EXCLUDED.stake_in,
        payout_out  = speed_daily_ngr.payout_out  + EXCLUDED.payout_out,
        cashout_out = speed_daily_ngr.cashout_out + EXCLUDED.cashout_out,
        refund_out  = speed_daily_ngr.refund_out  + EXCLUDED.refund_out,
        updated_at  = NOW();

  SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_daily_ngr_floor';
  v_floor := COALESCE(v_floor, -500);

  SELECT ngr, circuit_tripped_at INTO v_new_ngr, v_existing_trip
  FROM speed_daily_ngr WHERE ngr_date = CURRENT_DATE;

  IF v_new_ngr <= v_floor AND v_existing_trip IS NULL THEN
    UPDATE speed_daily_ngr
       SET circuit_tripped_at = NOW()
     WHERE ngr_date = CURRENT_DATE;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._speed_update_daily_ngr(DECIMAL, DECIMAL, DECIMAL, DECIMAL) IS
  '0016: upsert today''s row in speed_daily_ngr with a delta. Sets circuit_tripped_at the first time NGR crosses the floor today. Called from speed_resolve_market and speed_execute_cashout.';

-- ============================================================================
-- 4) RPC: speed_execute_trade — retail-only, casino-mode pricing
-- ============================================================================

DROP FUNCTION IF EXISTS public.speed_execute_trade(uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id       UUID,
  p_side            TEXT,
  p_stake           NUMERIC,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_user               RECORD;
  v_market             RECORD;
  v_oracle             RECORD;
  v_existing_dup       RECORD;

  v_master_enabled     DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_spread_pct         DECIMAL;
  v_extreme_coeff      DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_iv_to_use          DECIMAL;
  v_late_reject_s      DECIMAL;
  v_late_surcharge_pct DOUBLE PRECISION;

  v_pool_collateral    DECIMAL;
  v_max_side_pct       DECIMAL;
  v_max_cluster_pct    DECIMAL;
  v_max_user_daily     DECIMAL;
  v_circuit_tripped    TIMESTAMPTZ;

  v_stake_min          DECIMAL := 1.00;
  v_stake_max          DECIMAL := 25.00;
  v_cap_per_side       DECIMAL := 200.00;

  v_fair_prob_over     DECIMAL;
  v_fair_prob_side     DECIMAL;
  v_distance           DOUBLE PRECISION;
  v_overage            DOUBLE PRECISION;
  v_widened_spread     DOUBLE PRECISION;
  v_offered_prob       DECIMAL;

  v_seconds_left       DOUBLE PRECISION;
  v_payout_if_won      DECIMAL;

  v_user_market_sum    DECIMAL;
  v_user_daily_sum     DECIMAL;
  v_side_payout_sum    DECIMAL;
  v_cluster_payout_sum DECIMAL;
  v_strike_lo          DECIMAL;
  v_strike_hi          DECIMAL;

  v_position_id        UUID;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_side NOT IN ('over','under') THEN
    RAISE EXCEPTION 'Side must be over or under';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Stake must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Speed market not found';
  END IF;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Speed market has closed';
  END IF;
  IF NOW() < v_market.opens_at THEN
    RAISE EXCEPTION 'Speed market has not opened yet';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;
  IF v_market.strike_price IS NULL THEN
    RAISE EXCEPTION 'Speed market strike not yet finalized';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)', p_stake, v_stake_min, v_stake_max;
  END IF;

  SELECT COALESCE(SUM(stake), 0) INTO v_user_market_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';
  IF v_user_market_sum + p_stake > v_cap_per_side THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_per_side - v_user_market_sum);
  END IF;

  -- Per-user daily wager cap (across all markets, today UTC).
  SELECT rate INTO v_max_user_daily FROM fee_config WHERE fee_type = 'speed_max_user_daily_wager';
  v_max_user_daily := COALESCE(v_max_user_daily, 500);
  SELECT COALESCE(SUM(stake), 0) INTO v_user_daily_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND created_at >= CURRENT_DATE::TIMESTAMPTZ
    AND status IN ('open','won','lost','cashed_out');
  IF v_user_daily_sum + p_stake > v_max_user_daily THEN
    RAISE EXCEPTION 'Daily wager limit reached: $% of $% used today',
      v_user_daily_sum, v_max_user_daily;
  END IF;

  -- Daily NGR circuit breaker.
  SELECT circuit_tripped_at INTO v_circuit_tripped
  FROM speed_daily_ngr WHERE ngr_date = CURRENT_DATE;
  IF v_circuit_tripped IS NOT NULL THEN
    RAISE EXCEPTION 'Daily limit reached, try again tomorrow';
  END IF;

  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Pricing inputs.
  SELECT rate INTO v_spread_pct    FROM fee_config WHERE fee_type = 'speed_spread_pct';
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff';
  SELECT rate INTO v_iv            FROM fee_config WHERE fee_type = 'speed_iv_btc';
  v_spread_pct    := COALESCE(v_spread_pct, 0.05);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_iv            := COALESCE(v_iv, 0.60);

  -- IV snapshot drift check.
  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
    v_iv_to_use := p_expected_iv;
  ELSE
    v_iv_to_use := v_iv;
  END IF;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv_to_use
  );
  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- Spread layering: base + Seam 3 quadratic widening + late-window surcharge.
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  v_late_surcharge_pct := speed_late_window_surcharge_pct(v_seconds_left);
  v_widened_spread := v_widened_spread + v_late_surcharge_pct;

  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- Per-side market exposure cap.
  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);

  v_payout_if_won := p_stake / v_offered_prob;

  SELECT COALESCE(SUM(stake / entry_offered_prob), 0) INTO v_side_payout_sum
  FROM speed_positions
  WHERE market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';

  IF v_side_payout_sum + v_payout_if_won > v_max_side_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
      USING HINT = format('payout liability $%.2f vs cap $%.2f (%.0f%% of $%.0f pool)',
        v_side_payout_sum + v_payout_if_won,
        v_max_side_pct * v_pool_collateral,
        v_max_side_pct * 100, v_pool_collateral);
  END IF;

  -- Same-strike cluster cap.
  SELECT rate INTO v_max_cluster_pct FROM fee_config WHERE fee_type = 'speed_max_strike_cluster_pct';
  v_max_cluster_pct := COALESCE(v_max_cluster_pct, 0.30);

  v_strike_lo := v_market.strike_price * 0.995;
  v_strike_hi := v_market.strike_price * 1.005;

  SELECT COALESCE(SUM(p.stake / p.entry_offered_prob), 0) INTO v_cluster_payout_sum
  FROM speed_positions p
  JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status = 'open'
    AND p.side = p_side::speed_side
    AND m.status = 'open'
    AND m.asset = v_market.asset
    AND m.strike_price BETWEEN v_strike_lo AND v_strike_hi;

  IF v_cluster_payout_sum + v_payout_if_won > v_max_cluster_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Strike cluster exposure cap reached on % side', p_side
      USING HINT = format('cluster liability $%.2f vs cap $%.2f',
        v_cluster_payout_sum + v_payout_if_won, v_max_cluster_pct * v_pool_collateral);
  END IF;

  -- ATOMIC WRITES.
  INSERT INTO speed_positions (
    user_id, market_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, p_side::speed_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, iv_used, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, NULL, v_iv_to_use, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  UPDATE users SET
    balance_usd = balance_usd - p_stake,
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'position_id', v_position_id,
    'trade_id', v_trade_id,
    'side', p_side,
    'stake', ROUND(p_stake, 2),
    'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8),
    'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6),
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'iv_used', ROUND(v_iv_to_use, 6),
    'late_window_pct', ROUND(v_late_surcharge_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL) IS
  '0016: place a speed bet. Casino-mode pricing (5% base spread + Seam 3 widening + 3-tier late-window surcharge), IV snapshot/drift check, multi-dim exposure caps, daily NGR circuit breaker.';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL)
  TO PUBLIC;

-- ============================================================================
-- 5) RPC: speed_execute_cashout — continuous formula, IV snapshot, NGR update
-- ============================================================================

DROP FUNCTION IF EXISTS public.speed_execute_cashout(uuid, text);

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id     UUID,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_market_id         UUID;
  v_oracle            RECORD;

  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_drift_tolerance   DECIMAL;
  v_iv_to_use         DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_pct               DOUBLE PRECISION;

  v_fair_prob_over    DECIMAL;
  v_mark_prob         DECIMAL;
  v_decay             DECIMAL;
  v_liq               DECIMAL;
  v_cashout_amount    DECIMAL;

  v_existing_dup      RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate cashout — returning existing trade_id'
      );
    END IF;
  END IF;

  -- Pre-fetch market_id (no lock) so we can take the same advisory lock that
  -- speed_resolve_market uses, BEFORE any FOR UPDATE work. Eliminates the
  -- deadlock window with resolve (per mig 0013).
  SELECT market_id INTO v_market_id
  FROM speed_positions WHERE id = p_position_id;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('speed_resolve_' || v_market_id::TEXT));

  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not authorised for this position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  IF v_seconds_left < 5 THEN
    RAISE EXCEPTION 'Market closing — no cashouts in last 5 seconds';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  -- Pricing: continuous mark-to-market with IV snapshot.
  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  v_iv := COALESCE(v_iv, 0.60);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
    v_iv_to_use := p_expected_iv;
  ELSE
    v_iv_to_use := v_iv;
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_pct := CASE WHEN v_seconds_total > 0 THEN v_seconds_left / v_seconds_total ELSE 0 END;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv_to_use
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
  END IF;

  v_decay := speed_cashout_multiplier(v_market.duration, v_pct);
  v_liq   := speed_liq_discount(v_seconds_left);

  -- Continuous formula: cashout = stake × (mark/entry) × decay × liq.
  -- One formula, no winner/loser branch, no role-boundary discontinuity.
  v_cashout_amount := v_position.stake
                    * (v_mark_prob / v_position.entry_offered_prob)
                    * v_decay
                    * v_liq;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- ATOMIC WRITES.
  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier,
    iv_used, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_mark_prob, v_position.entry_offered_prob, v_decay,
    v_iv_to_use, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (decay ' || v_decay || ', liq ' || v_liq ||
      ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
    );
  END IF;

  PERFORM _speed_update_daily_ngr(0, 0, v_cashout_amount, 0);

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'position_id', p_position_id,
    'cashout_amount', v_cashout_amount,
    'mark_prob', ROUND(v_mark_prob, 6),
    'decay', ROUND(v_decay, 4),
    'liq_discount', ROUND(v_liq, 4),
    'iv_used', ROUND(v_iv_to_use, 6),
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) IS
  '0016: cash out a single open speed position. Continuous formula (stake × mark_prob/entry_offered × decay × liq). No winner/loser branch. IV snapshot/drift check. < 5s rejected.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL)
  TO PUBLIC;

-- ============================================================================
-- 6) RPC: speed_resolve_market — exact-tick + wick detector + audit + NGR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.speed_resolve_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_acquired   BOOLEAN;
  v_market          RECORD;
  v_outcome         speed_market_outcome;

  v_exact_tick      RECORD;
  v_tick_5s_before  RECORD;
  v_price_delta_pct DECIMAL;
  v_wick_threshold  DECIMAL;
  v_wick_detected   BOOLEAN := FALSE;
  v_median_price    DECIMAL;
  v_median_count    INTEGER;
  v_settlement_price DECIMAL;
  v_raw_ticks       JSONB;

  v_pos             RECORD;
  v_payout          DECIMAL;
  v_winners         INTEGER := 0;
  v_losers          INTEGER := 0;
  v_refunded        INTEGER := 0;
  v_total_paid      DECIMAL := 0;
  v_total_refunded  DECIMAL := 0;
  v_total_stake     DECIMAL := 0;
  v_existing        RECORD;
  v_new_balance     DECIMAL;
  v_voided          BOOLEAN := FALSE;
  v_void_reason     TEXT;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('skipped', TRUE, 'reason', 'Another invocation is already resolving this market');
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open','resolving') THEN
    RETURN jsonb_build_object('skipped', TRUE, 'status', v_market.status, 'reason', 'Market not in resolvable state');
  END IF;
  IF NOW() < v_market.closes_at THEN
    RAISE EXCEPTION 'Market has not closed yet';
  END IF;

  UPDATE speed_markets SET status = 'resolving', updated_at = NOW()
  WHERE id = p_market_id AND status = 'open';

  -- Exact tick at-or-before closes_at.
  SELECT price, ts AS received_at
  INTO v_exact_tick
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset AND ts <= v_market.closes_at
  ORDER BY ts DESC
  LIMIT 1;

  IF v_exact_tick IS NULL THEN
    v_voided := TRUE;
    v_void_reason := 'No oracle tick at or before close';
  END IF;

  -- Wick detector.
  IF NOT v_voided THEN
    SELECT price, ts AS received_at
    INTO v_tick_5s_before
    FROM speed_oracle_ticks
    WHERE asset = v_market.asset
      AND ts <= v_market.closes_at - INTERVAL '5 seconds'
    ORDER BY ts DESC
    LIMIT 1;

    IF v_tick_5s_before IS NOT NULL AND v_tick_5s_before.price > 0 THEN
      v_price_delta_pct := ABS(v_exact_tick.price - v_tick_5s_before.price) / v_tick_5s_before.price;

      SELECT rate INTO v_wick_threshold FROM fee_config WHERE fee_type = 'speed_wick_threshold_pct';
      v_wick_threshold := COALESCE(v_wick_threshold, 0.001);

      IF v_wick_threshold > 0 AND v_price_delta_pct > v_wick_threshold THEN
        v_wick_detected := TRUE;
      END IF;
    END IF;
  END IF;

  IF v_wick_detected THEN
    WITH last_ticks AS (
      SELECT price
      FROM speed_oracle_ticks
      WHERE asset = v_market.asset AND ts <= v_market.closes_at
      ORDER BY ts DESC
      LIMIT 30
    )
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::DECIMAL,
      COUNT(*)
    INTO v_median_price, v_median_count
    FROM last_ticks;

    IF v_median_price IS NULL OR v_median_count < 5 THEN
      v_voided := TRUE;
      v_void_reason := 'Wick detected but insufficient ticks for median fallback';
    END IF;
  END IF;

  IF NOT v_voided THEN
    SELECT jsonb_agg(jsonb_build_object('ts', ts, 'price', price) ORDER BY ts ASC)
    INTO v_raw_ticks
    FROM (
      SELECT ts, price FROM speed_oracle_ticks
      WHERE asset = v_market.asset AND ts <= v_market.closes_at
      ORDER BY ts DESC
      LIMIT 30
    ) sub;
  END IF;

  -- Void path.
  IF v_voided THEN
    FOR v_pos IN
      SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open'
    LOOP
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;

      v_total_stake := v_total_stake + v_pos.stake;

      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
              'Speed market voided — full refund');

      UPDATE speed_positions SET status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      INSERT INTO speed_settlements (position_id, market_id, user_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, 'at_strike', v_pos.stake);

      v_refunded := v_refunded + 1;
      v_total_refunded := v_total_refunded + v_pos.stake;
    END LOOP;

    UPDATE speed_markets SET status = 'voided', updated_at = NOW(), resolved_at = NOW(),
                            twap_at_close = NULL, void_reason = v_void_reason
    WHERE id = p_market_id;

    PERFORM _speed_update_daily_ngr(v_total_stake, 0, 0, v_total_refunded);

    RETURN jsonb_build_object(
      'success', TRUE, 'voided', TRUE, 'reason', v_void_reason,
      'refunded', v_refunded,
      'refunded_total', ROUND(v_total_refunded, 2)
    );
  END IF;

  v_settlement_price := COALESCE(v_median_price, v_exact_tick.price);

  -- Audit row.
  INSERT INTO speed_market_settlement_audit (
    market_id, resolved_at, closes_at,
    exact_tick_price, exact_tick_at,
    price_5s_before, price_delta_pct,
    wick_detected, fallback_median_price, fallback_tick_count,
    final_settlement_price, raw_ticks
  ) VALUES (
    p_market_id, NOW(), v_market.closes_at,
    v_exact_tick.price, v_exact_tick.received_at,
    CASE WHEN v_tick_5s_before IS NOT NULL THEN v_tick_5s_before.price ELSE NULL END,
    v_price_delta_pct,
    v_wick_detected, v_median_price, v_median_count,
    v_settlement_price, v_raw_ticks
  ) ON CONFLICT (market_id) DO UPDATE
    SET resolved_at = EXCLUDED.resolved_at,
        exact_tick_price = EXCLUDED.exact_tick_price,
        exact_tick_at = EXCLUDED.exact_tick_at,
        price_5s_before = EXCLUDED.price_5s_before,
        price_delta_pct = EXCLUDED.price_delta_pct,
        wick_detected = EXCLUDED.wick_detected,
        fallback_median_price = EXCLUDED.fallback_median_price,
        fallback_tick_count = EXCLUDED.fallback_tick_count,
        final_settlement_price = EXCLUDED.final_settlement_price,
        raw_ticks = EXCLUDED.raw_ticks;

  IF v_settlement_price > v_market.strike_price THEN
    v_outcome := 'over';
  ELSIF v_settlement_price < v_market.strike_price THEN
    v_outcome := 'under';
  ELSE
    v_outcome := 'at_strike';
  END IF;

  FOR v_pos IN
    SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open'
  LOOP
    SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
    IF FOUND THEN CONTINUE; END IF;

    v_total_stake := v_total_stake + v_pos.stake;

    IF v_outcome = 'at_strike' THEN
      v_payout := v_pos.stake;
      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_payout, v_new_balance, v_pos.id,
              'Speed market settled at strike — push refund');

      UPDATE speed_positions SET status = 'refunded', payout_amount = v_payout, closed_at = NOW()
      WHERE id = v_pos.id;
      v_refunded := v_refunded + 1;
      v_total_refunded := v_total_refunded + v_payout;

    ELSIF v_pos.side = v_outcome::TEXT THEN
      v_payout := ROUND(v_pos.stake / v_pos.entry_offered_prob, 2);
      v_winners := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;

      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_payout', v_payout, v_new_balance, v_pos.id,
              'Speed payout (' || v_pos.side || ')');

      UPDATE speed_positions SET status = 'won', payout_amount = v_payout, closed_at = NOW()
      WHERE id = v_pos.id;
    ELSE
      v_losers := v_losers + 1;
      v_payout := 0;
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;
    END IF;

    INSERT INTO speed_settlements (position_id, market_id, user_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_outcome, v_payout);
  END LOOP;

  UPDATE speed_markets SET status = 'resolved', updated_at = NOW(), resolved_at = NOW(),
                          twap_at_close = v_settlement_price, outcome = v_outcome
  WHERE id = p_market_id;

  PERFORM _speed_update_daily_ngr(v_total_stake, v_total_paid, 0, v_total_refunded);

  RETURN jsonb_build_object(
    'success', TRUE, 'voided', FALSE, 'outcome', v_outcome,
    'settlement_price', ROUND(v_settlement_price, 8),
    'wick_detected', v_wick_detected,
    'price_delta_pct', v_price_delta_pct,
    'strike', ROUND(v_market.strike_price, 8),
    'winners', v_winners, 'losers', v_losers, 'refunded', v_refunded,
    'total_paid', ROUND(v_total_paid, 2),
    'total_refunded', ROUND(v_total_refunded, 2)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_resolve_market(UUID) IS
  '0016: resolve a speed market. Exact-tick settlement (latest tick at-or-before closes_at) with wick-detector safety net. Writes audit row to speed_market_settlement_audit. Updates speed_daily_ngr.';

GRANT EXECUTE ON FUNCTION public.speed_resolve_market(UUID)
  TO PUBLIC;

-- ============================================================================
-- 7) Sanity assertion — fail loudly if any required fee_config row is missing
-- ============================================================================
DO $$
DECLARE
  v_required TEXT[] := ARRAY[
    'speed_spread_pct',
    'speed_extreme_spread_coeff',
    'speed_max_market_exposure_pct',
    'speed_pool_collateral_usd',
    'speed_max_user_daily_wager',
    'speed_max_strike_cluster_pct',
    'speed_daily_ngr_floor',
    'speed_wick_threshold_pct',
    'speed_late_window_60s_pct',
    'speed_late_window_30s_pct',
    'speed_late_window_reject_s',
    'speed_iv_drift_tolerance_pct',
    'speed_cashout_decay_5m_ge80','speed_cashout_decay_5m_60to80',
    'speed_cashout_decay_5m_40to60','speed_cashout_decay_5m_20to40','speed_cashout_decay_5m_lt20',
    'speed_cashout_decay_1h_ge80','speed_cashout_decay_1h_60to80',
    'speed_cashout_decay_1h_40to60','speed_cashout_decay_1h_20to40','speed_cashout_decay_1h_lt20',
    'speed_liq_discount_gt30','speed_liq_discount_10to30','speed_liq_discount_5to10'
  ];
  v_missing TEXT[];
BEGIN
  SELECT ARRAY(
    SELECT k FROM unnest(v_required) AS k
    WHERE NOT EXISTS (SELECT 1 FROM fee_config WHERE fee_type = k)
  ) INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '0016: missing fee_config rows: %', v_missing;
  END IF;
END $$;

COMMIT;
