-- 0007_chart_rpcs.sql — port the 4 RPCs called by surviving client hooks.
--
-- W7 cleanup: client hooks invoke get_speed_price_history, get_speed_klines,
-- get_speed_volatility, get_admin_sidebar_counts. These existed in
-- prediction-market migrations but were never copied forward.
--
-- Adaptations vs originals:
--   * speed_asset enum → TEXT (Sooq's slim schema uses speed_assets table FK)
--   * auth.uid() → app.user_id() (Auth.js GUC pattern)
--   * deposits status set: drop 'pending_review' (only 'pending' in v1 schema)
--   * speed_oracle_klines doesn't exist in slim schema — synthesize OHLC
--     from speed_oracle_ticks instead (the pre-mig-343 pattern)
--   * speed_realized_vol_cache doesn't exist — get_speed_volatility returns
--     the fallback path only (reads fee_config.speed_iv_btc, no caching).
--     v2 wires the kline-based RV worker.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. get_admin_sidebar_counts — admin-only, returns pending finance counts
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_admin_sidebar_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_caller UUID;
  v_is_admin BOOLEAN;
  v_pending_deposits INTEGER;
  v_pending_withdrawals INTEGER;
BEGIN
  v_caller := app.user_id();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM users WHERE id = v_caller;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_pending_deposits
  FROM deposits WHERE status = 'pending';

  SELECT COUNT(*) INTO v_pending_withdrawals
  FROM withdrawals WHERE status = 'pending';

  RETURN jsonb_build_object(
    'pending_deposits', v_pending_deposits,
    'pending_withdrawals', v_pending_withdrawals,
    'pending_finance', v_pending_deposits + v_pending_withdrawals
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. get_speed_price_history — bucketed AVG price line
-- ═══════════════════════════════════════════════════════════════════
--
-- Returns ≤ p_max_points evenly-spaced buckets (AVG price each) over
-- [p_from, p_to]. Empty buckets are skipped (chart connects across gaps).

CREATE OR REPLACE FUNCTION get_speed_price_history(
  p_asset TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_max_points INTEGER DEFAULT 500
)
RETURNS TABLE(ts TIMESTAMPTZ, price NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
BEGIN
  IF p_max_points < 10 THEN p_max_points := 10; END IF;
  IF p_to <= p_from THEN
    RETURN;
  END IF;

  v_bucket_secs := GREATEST(1, EXTRACT(EPOCH FROM (p_to - p_from)) / p_max_points);

  RETURN QUERY
  SELECT
    (to_timestamp(
      floor(EXTRACT(EPOCH FROM t.ts) / v_bucket_secs) * v_bucket_secs
    ))::TIMESTAMPTZ AS ts,
    AVG(t.price)::NUMERIC AS price
  FROM speed_oracle_ticks t
  WHERE t.asset = p_asset
    AND t.ts >= p_from
    AND t.ts <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_speed_price_history(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO PUBLIC;


-- ═══════════════════════════════════════════════════════════════════
-- 3. get_speed_klines — synthesize OHLC from raw ticks
-- ═══════════════════════════════════════════════════════════════════
--
-- Sooq slim schema doesn't have speed_oracle_klines (no kline-source worker
-- in v1; a Binance @kline_1s subscriber comes in v2). Synthesize OHLC from
-- speed_oracle_ticks per bucket.

CREATE OR REPLACE FUNCTION get_speed_klines(
  p_asset TEXT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_max_buckets INTEGER DEFAULT 200
)
RETURNS TABLE(
  bucket_time TIMESTAMPTZ,
  o NUMERIC,
  h NUMERIC,
  l NUMERIC,
  c NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
BEGIN
  IF p_max_buckets < 10 THEN p_max_buckets := 10; END IF;
  IF p_to <= p_from THEN
    RETURN;
  END IF;

  v_bucket_secs := GREATEST(1, EXTRACT(EPOCH FROM (p_to - p_from)) / p_max_buckets);

  RETURN QUERY
  WITH ticks AS (
    SELECT
      t.ts,
      t.price,
      (to_timestamp(
        floor(EXTRACT(EPOCH FROM t.ts) / v_bucket_secs) * v_bucket_secs
      ))::TIMESTAMPTZ AS bkt
    FROM speed_oracle_ticks t
    WHERE t.asset = p_asset
      AND t.ts >= p_from
      AND t.ts <= p_to
  ),
  ranked AS (
    SELECT
      ts, price, bkt,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts ASC)  AS rn_open,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts DESC) AS rn_close
    FROM ticks
  )
  SELECT
    bkt AS bucket_time,
    MAX(CASE WHEN rn_open  = 1 THEN price END)::NUMERIC AS o,
    MAX(price)::NUMERIC                                 AS h,
    MIN(price)::NUMERIC                                 AS l,
    MAX(CASE WHEN rn_close = 1 THEN price END)::NUMERIC AS c
  FROM ranked
  GROUP BY bkt
  ORDER BY bkt;
END;
$$;

GRANT EXECUTE ON FUNCTION get_speed_klines(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO PUBLIC;


-- ═══════════════════════════════════════════════════════════════════
-- 4. get_speed_volatility — simplified fallback-only RV
-- ═══════════════════════════════════════════════════════════════════
--
-- v1 doesn't have the realized-vol cache table or the worker that
-- populates it. Always returns the fallback rv from fee_config.speed_iv_btc.
-- v2 reintroduces the kline-based RV worker + caching.

CREATE OR REPLACE FUNCTION get_speed_volatility(p_asset TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor NUMERIC;
BEGIN
  -- p_asset is currently advisory; v1 only has BTC and we use a single
  -- IV floor. Future assets can swap to a per-asset row in fee_config.
  PERFORM 1 WHERE p_asset IS NOT NULL;

  SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;

  RETURN jsonb_build_object(
    'rv', COALESCE(v_floor, 0.6),
    'computed_at', NOW(),
    'source', 'fallback'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_speed_volatility(TEXT) TO PUBLIC;


-- Seed the IV floor (v1 default = 0.6 = 60% annualized).
INSERT INTO fee_config (fee_type, rate, description)
VALUES ('speed_iv_btc', 0.6, 'BTC implied volatility floor (annualized) — used by speed pricing until RV worker lands in v2.')
ON CONFLICT (fee_type) DO NOTHING;

COMMIT;
