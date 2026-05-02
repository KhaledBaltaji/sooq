-- ============================================================================
-- 333_speed_price_history_rpc.sql
--
-- Server-side aggregation for speed-market chart data.
--
-- Why: pulling raw speed_oracle_ticks for a 24h window = ~260K rows at
-- ~3 ticks/sec. Recharts chokes past ~5K points; the browser freezes.
-- This RPC buckets ticks into ≤ p_max_points evenly-spaced buckets and
-- returns the average price per bucket. Chart renders smoothly regardless
-- of duration (5m / 15m / 1h / 24h) with the same payload size.
--
-- Bucket strategy: divide the time range into N equal-width buckets,
-- compute AVG(price) per bucket. Empty buckets are skipped (chart will
-- naturally connect across gaps). For sub-second precision, use
-- date_trunc + interval math.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_speed_price_history(
  p_asset speed_asset,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_max_points INTEGER DEFAULT 500
)
RETURNS TABLE(ts TIMESTAMPTZ, price DECIMAL)
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
    RETURN; -- empty result
  END IF;

  v_bucket_secs := GREATEST(1, EXTRACT(EPOCH FROM (p_to - p_from)) / p_max_points);

  RETURN QUERY
  SELECT
    (to_timestamp(
      floor(EXTRACT(EPOCH FROM t.ts) / v_bucket_secs) * v_bucket_secs
    ))::TIMESTAMPTZ AS ts,
    AVG(t.price)::DECIMAL AS price
  FROM speed_oracle_ticks t
  WHERE t.asset = p_asset
    AND t.ts >= p_from
    AND t.ts <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

COMMENT ON FUNCTION get_speed_price_history(speed_asset, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) IS
'Returns time-bucketed AVG price for a speed asset between p_from and p_to. ≤ p_max_points buckets. Used by SpeedPriceChart on /speed/[id].';
