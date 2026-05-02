-- 164_all_period_from_creation.sql — ALL period starts from market creation date
-- Fix: ALL was starting from first trade, missing the pre-trade 50% flat period.
-- ALL should show the full market lifetime from creation.

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
  v_first_trade TIMESTAMPTZ;
  -- LMSR initial price is always 0.5 when q_yes = q_no = 0
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  -- Find the first trade time for this market
  SELECT MIN(t.created_at) INTO v_first_trade
  FROM trades t WHERE t.market_id = p_market_id;

  -- Determine time range and bucket interval based on period
  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '6H'  THEN v_start := v_end - INTERVAL '6 hours';   v_interval := INTERVAL '2 minutes';
    WHEN '12H' THEN v_start := v_end - INTERVAL '12 hours';  v_interval := INTERVAL '3 minutes';
    WHEN '1D'  THEN v_start := v_end - INTERVAL '1 day';     v_interval := INTERVAL '5 minutes';
    WHEN '1W'  THEN v_start := v_end - INTERVAL '7 days';    v_interval := INTERVAL '30 minutes';
    WHEN '1M'  THEN v_start := v_end - INTERVAL '30 days';   v_interval := INTERVAL '2 hours';
    WHEN 'ALL' THEN
      -- Start from market creation date to show full lifetime
      v_start := COALESCE(p_created_at, v_end - INTERVAL '30 days');
      v_interval := GREATEST(
        (v_end - v_start) / 500,
        INTERVAL '1 minute'
      );
    ELSE
      v_start := v_end - INTERVAL '1 day'; v_interval := INTERVAL '5 minutes';
  END CASE;

  -- For fixed time periods (1H, 12H, 1D, 1W, 1M), if the first trade
  -- happened after the period start, shift start forward to avoid dead space.
  -- Keep a small buffer (10% of period) before the first trade for context.
  IF p_period != 'ALL' AND v_first_trade IS NOT NULL THEN
    DECLARE
      v_period_duration INTERVAL;
      v_buffer INTERVAL;
    BEGIN
      v_period_duration := v_end - v_start;
      v_buffer := v_period_duration * 0.1;  -- 10% buffer
      -- Only shift if first trade is more than 50% into the period
      IF v_first_trade > v_start + v_period_duration * 0.5 THEN
        v_start := v_first_trade - v_buffer;
      END IF;
    END;
  END IF;

  -- Generate time buckets and find the most recent trade price at or before each bucket.
  -- Uses post_yes_price/post_no_price (post-trade marginal price) when available,
  -- falls back to price_per_share derivation for pre-migration trades.
  -- Pre-trade buckets fall back to 0.5 (LMSR initial price).
  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(tr.post_yes_price,
        CASE WHEN tr.side::text = 'yes' THEN tr.price_per_share
             ELSE 1 - tr.price_per_share END) AS y_price,
      COALESCE(tr.post_no_price,
        CASE WHEN tr.side::text = 'yes' THEN 1 - tr.price_per_share
             ELSE tr.price_per_share END) AS n_price
    FROM trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;

GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO anon;
