-- ============================================================================
-- 334_speed_price_history_ohlc.sql
--
-- OHLC bucketing for the speed-market candlestick chart.
--
-- Why: mig 333 returns AVG(price) per bucket (smooth area chart). Polymarket
-- shows candles, which read better at this cadence and let users see intra-
-- bucket volatility. TradingView's lightweight-charts wants {time, open, high,
-- low, close} per bucket. Same bucket math as 333, but emits 4 fields.
--
-- Bucket strategy: same time-window math as get_speed_price_history. Within
-- each bucket: open = first tick, close = last tick (by ts), high = MAX,
-- low = MIN. We use FIRST_VALUE / LAST_VALUE window functions partitioned by
-- bucket so we don't need a self-join.
--
-- Default 200 buckets — fewer wider candles read better than 500 thin ones,
-- and lightweight-charts handles the rest.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_speed_price_history_ohlc(
  p_asset speed_asset,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_max_buckets INTEGER DEFAULT 200
)
RETURNS TABLE(
  ts TIMESTAMPTZ,
  open_price DECIMAL,
  high_price DECIMAL,
  low_price DECIMAL,
  close_price DECIMAL
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
      ))::TIMESTAMPTZ AS bucket_ts
    FROM speed_oracle_ticks t
    WHERE t.asset = p_asset
      AND t.ts >= p_from
      AND t.ts <= p_to
  ),
  bucketed AS (
    SELECT
      bucket_ts,
      FIRST_VALUE(price) OVER w AS open_price,
      LAST_VALUE(price)  OVER w AS close_price,
      MAX(price) OVER (PARTITION BY bucket_ts) AS high_price,
      MIN(price) OVER (PARTITION BY bucket_ts) AS low_price,
      ROW_NUMBER() OVER (PARTITION BY bucket_ts ORDER BY ts) AS rn
    FROM ticks
    WINDOW w AS (
      PARTITION BY bucket_ts
      ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT
    bucket_ts AS ts,
    open_price::DECIMAL,
    high_price::DECIMAL,
    low_price::DECIMAL,
    close_price::DECIMAL
  FROM bucketed
  WHERE rn = 1
  ORDER BY bucket_ts;
END;
$$;

COMMENT ON FUNCTION get_speed_price_history_ohlc(speed_asset, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) IS
'Returns OHLC candles for a speed asset, time-bucketed. Used by SpeedPriceChart (lightweight-charts) on /speed/[id].';
