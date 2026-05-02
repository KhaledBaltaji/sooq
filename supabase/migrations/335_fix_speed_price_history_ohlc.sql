-- ============================================================================
-- 335_fix_speed_price_history_ohlc.sql
--
-- Fixes the runtime "column reference 'ts' is ambiguous" error in mig 334.
--
-- Why mig 334 broke: PL/pgSQL functions with `RETURNS TABLE(ts ...)` put the
-- output column name in scope as a variable. Inside the function body, the
-- WINDOW clause `ORDER BY ts` was unqualified — Postgres couldn't tell whether
-- it meant the OUT column or `speed_oracle_ticks.ts`, raised SQLSTATE 42702.
-- Every chart load on /speed/[id] errored out and rendered "Chart unavailable".
--
-- Fix: rename OUT columns to non-conflicting names (`bucket_time`, `o`, `h`,
-- `l`, `c`). Same compute path. Client hook updated in same push.
--
-- Postgres requires DROP + CREATE when the RETURNS TABLE column names change
-- (CREATE OR REPLACE rejects signature changes), hence the DROP IF EXISTS.
-- ============================================================================

DROP FUNCTION IF EXISTS get_speed_price_history_ohlc(speed_asset, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);

CREATE FUNCTION get_speed_price_history_ohlc(
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
  bucketed AS (
    SELECT
      bkt,
      FIRST_VALUE(price) OVER w AS open_p,
      LAST_VALUE(price)  OVER w AS close_p,
      MAX(price) OVER (PARTITION BY bkt) AS high_p,
      MIN(price) OVER (PARTITION BY bkt) AS low_p,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts) AS rn
    FROM ticks
    WINDOW w AS (
      PARTITION BY bkt
      ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT
    bkt AS bucket_time,
    open_p::DECIMAL AS o,
    high_p::DECIMAL AS h,
    low_p::DECIMAL AS l,
    close_p::DECIMAL AS c
  FROM bucketed
  WHERE rn = 1
  ORDER BY bkt;
END;
$$;

COMMENT ON FUNCTION get_speed_price_history_ohlc(speed_asset, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) IS
'Returns OHLC candles for a speed asset, time-bucketed. Output columns named to avoid PL/pgSQL ambiguity with speed_oracle_ticks.ts. Used by SpeedPriceChart on /speed/[id].';
