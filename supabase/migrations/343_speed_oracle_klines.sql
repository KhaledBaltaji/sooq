-- ============================================================================
-- 343_speed_oracle_klines.sql
--
-- Push F — switch chart data source from synthesized OHLC (bucketing raw
-- trade ticks) to Binance's pre-built 1-second candles (klines).
--
-- Why:
--   Today's chart synthesizes candles from `speed_oracle_ticks` (raw individual
--   trades from `@trade` stream) via mig 333/335 RPCs that bucket+aggregate.
--   This works but produces "feels janky" candles vs Binance's own chart, and
--   we eat synthesis CPU on every chart read.
--
--   Switch the worker to subscribe to `@kline_1s` instead. Binance pushes
--   ready-made OHLC every second. We store as-is. Chart RPC simplifies to
--   `SELECT *` from this table.
--
-- Cutover strategy (eng-review locked):
--   DUAL-WRITE during transition. Worker writes BOTH:
--     - `speed_oracle_klines` rows (full OHLC, NEW table — chart reads these)
--     - `speed_oracle_ticks` rows synthesized from kline closes
--       (price = kline.close, ts = kline.t — settlement keeps reading these)
--
--   Once stable, drop tick writes in a follow-up migration. Settlement RPC
--   (`speed_resolve_market`, mig 321) is UNCHANGED — keeps reading ticks.
-- ============================================================================

-- ─── 1. Klines table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS speed_oracle_klines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset       speed_asset NOT NULL,
  source      TEXT NOT NULL DEFAULT 'binance',
  ts          TIMESTAMPTZ NOT NULL,           -- kline open time (start of 1s bucket)
  open_price  DECIMAL(18,8) NOT NULL CHECK (open_price > 0),
  high_price  DECIMAL(18,8) NOT NULL CHECK (high_price > 0),
  low_price   DECIMAL(18,8) NOT NULL CHECK (low_price > 0),
  close_price DECIMAL(18,8) NOT NULL CHECK (close_price > 0),
  volume      DECIMAL(18,8) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_speed_klines_asset_ts
  ON speed_oracle_klines (asset, ts DESC);

-- Dedupe: one closed kline per (asset, ts, source). Worker writes once per
-- closed bucket; if it retries, ON CONFLICT DO NOTHING via the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_speed_klines_dedupe
  ON speed_oracle_klines (asset, ts, source);

-- RLS: mirror speed_oracle_ticks policy — admin/service-role only for writes,
-- public read so chart hook can hit RPC without auth (RPC is SECURITY INVOKER).
ALTER TABLE speed_oracle_klines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS speed_oracle_klines_admin_all ON speed_oracle_klines;
CREATE POLICY speed_oracle_klines_admin_all ON speed_oracle_klines
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS speed_oracle_klines_public_read ON speed_oracle_klines;
CREATE POLICY speed_oracle_klines_public_read ON speed_oracle_klines
  FOR SELECT TO anon, authenticated
  USING (TRUE);

-- ─── 2. Chart RPC ─────────────────────────────────────────────────────────
--
-- Replaces the bucketing logic of mig 335's get_speed_price_history_ohlc.
-- Klines are already 1-second OHLC, so for sub-minute chart windows we just
-- return them as-is. For longer windows (1h, 24h) we still need to bucket
-- multiple klines together to keep payload size bounded — but the math is
-- much simpler than synthesizing OHLC from raw ticks.

CREATE OR REPLACE FUNCTION get_speed_klines(
  p_asset speed_asset,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_max_buckets INTEGER DEFAULT 200
)
RETURNS TABLE(
  bucket_time TIMESTAMPTZ,
  o DECIMAL,
  h DECIMAL,
  l DECIMAL,
  c DECIMAL
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
  v_total_secs DOUBLE PRECISION;
BEGIN
  IF p_max_buckets < 10 THEN p_max_buckets := 10; END IF;
  IF p_to <= p_from THEN
    RETURN;
  END IF;

  v_total_secs := EXTRACT(EPOCH FROM (p_to - p_from));
  v_bucket_secs := GREATEST(1, v_total_secs / p_max_buckets);

  -- Fast path: window fits within max_buckets at 1s granularity → return raw klines
  IF v_bucket_secs <= 1 THEN
    RETURN QUERY
    SELECT
      k.ts AS bucket_time,
      k.open_price::DECIMAL AS o,
      k.high_price::DECIMAL AS h,
      k.low_price::DECIMAL AS l,
      k.close_price::DECIMAL AS c
    FROM speed_oracle_klines k
    WHERE k.asset = p_asset
      AND k.ts >= p_from
      AND k.ts <= p_to
    ORDER BY k.ts;
    RETURN;
  END IF;

  -- Slow path: aggregate multiple klines per bucket. Same OHLC semantics
  -- as the synthesis RPCs but starting from already-aggregated 1s candles.
  RETURN QUERY
  WITH klines AS (
    SELECT
      k.ts,
      k.open_price,
      k.high_price,
      k.low_price,
      k.close_price,
      (to_timestamp(
        floor(EXTRACT(EPOCH FROM k.ts) / v_bucket_secs) * v_bucket_secs
      ))::TIMESTAMPTZ AS bkt
    FROM speed_oracle_klines k
    WHERE k.asset = p_asset
      AND k.ts >= p_from
      AND k.ts <= p_to
  ),
  bucketed AS (
    SELECT
      bkt,
      FIRST_VALUE(open_price) OVER w  AS open_b,
      LAST_VALUE(close_price) OVER w  AS close_b,
      MAX(high_price) OVER (PARTITION BY bkt) AS high_b,
      MIN(low_price)  OVER (PARTITION BY bkt) AS low_b,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts) AS rn
    FROM klines
    WINDOW w AS (
      PARTITION BY bkt
      ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT
    bkt AS bucket_time,
    open_b::DECIMAL AS o,
    high_b::DECIMAL AS h,
    low_b::DECIMAL  AS l,
    close_b::DECIMAL AS c
  FROM bucketed
  WHERE rn = 1
  ORDER BY bkt;
END;
$$;

COMMENT ON FUNCTION get_speed_klines(speed_asset, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) IS
'Returns OHLC candles for chart rendering. Sub-minute windows return raw 1s klines as-is; longer windows aggregate. Settlement still uses speed_oracle_ticks via speed_resolve_market.';

-- ─── 3. Realtime publication for live tail (optional) ─────────────────────
-- The chart subscribes to speed_oracle_latest for the live tail (single row).
-- Klines table is read via RPC every 30s, no realtime channel needed here.
-- Keeping speed_oracle_klines OUT of the realtime publication avoids fanout.
