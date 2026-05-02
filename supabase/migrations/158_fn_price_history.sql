-- 158_fn_price_history.sql — RPC for time-bucketed price history (Polymarket-style chart)

BEGIN;

CREATE OR REPLACE FUNCTION get_price_history(
  p_market_id   UUID,
  p_period      TEXT DEFAULT '1D',
  p_created_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  bucket_time TIMESTAMPTZ,
  yes_price   DECIMAL,
  no_price    DECIMAL
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ := NOW();
  v_interval INTERVAL;
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  -- Determine time range and bucket interval based on period
  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '12H' THEN v_start := v_end - INTERVAL '12 hours';  v_interval := INTERVAL '3 minutes';
    WHEN '1D'  THEN v_start := v_end - INTERVAL '1 day';     v_interval := INTERVAL '5 minutes';
    WHEN '1W'  THEN v_start := v_end - INTERVAL '7 days';    v_interval := INTERVAL '30 minutes';
    WHEN '1M'  THEN v_start := v_end - INTERVAL '30 days';   v_interval := INTERVAL '2 hours';
    WHEN 'ALL' THEN
      v_start := COALESCE(p_created_at, v_end - INTERVAL '30 days');
      -- Dynamic interval: total span / 500 buckets, minimum 1 minute
      v_interval := GREATEST(
        (v_end - v_start) / 500,
        INTERVAL '1 minute'
      );
    ELSE
      v_start := v_end - INTERVAL '1 day'; v_interval := INTERVAL '5 minutes';
  END CASE;

  -- Get AMM initial price as fallback when no trade precedes a bucket
  SELECT a.current_yes_price, a.current_no_price
  INTO v_initial_yes, v_initial_no
  FROM amm_state a WHERE a.market_id = p_market_id;

  -- Generate time buckets and find the most recent trade price at or before each bucket
  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN tr.side = 'yes' THEN tr.price_per_share
           ELSE 1 - tr.price_per_share END AS y_price,
      CASE WHEN tr.side = 'yes' THEN 1 - tr.price_per_share
           ELSE tr.price_per_share END AS n_price
    FROM trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO anon;

COMMIT;
