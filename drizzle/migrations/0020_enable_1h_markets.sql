-- 0020_enable_1h_markets.sql
--
-- Wire the cron + boundary helper to actually create 1h markets now that
-- mig 0019 added '1h' to the speed_duration enum. Two function rewrites:
--
--   1) _next_clean_boundary — add a '1h' branch (next clean hour, with
--      30s post-boundary tolerance like 5m).
--   2) speed_roll_markets — change the durations array from
--      ARRAY['5m','15m','24h'] to ARRAY['5m','1h']. Drop the 15m + 24h
--      branches in the closes_at CASE (they're no longer reachable from
--      the loop) and the 24h-specific guard. Existing 15m + 24h rows in
--      the DB stay untouched (historical FK integrity, hidden from the
--      public feed by the API filter).

-- ───────────────────────────────────────────────────────────────────────
-- 1) _next_clean_boundary — add 1h, drop 15m + 24h branches
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _next_clean_boundary(p_duration speed_duration, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  -- 30s post-boundary tolerance lets a roll fired right after a market
  -- resolved (cron firing at e.g. :05:05 right after :05 resolution)
  -- anchor at :05 instead of jumping to :10.
  SELECT CASE p_duration
    WHEN '5m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 5 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 5)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 5) + 1)
      END
    WHEN '1h'::speed_duration THEN
      CASE
        WHEN EXTRACT(MINUTE FROM p_now) = 0
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
        ELSE
          date_trunc('hour', p_now) + INTERVAL '1 hour'
      END
    -- Historical enum values still reachable in case any callsite passes
    -- them — return the same shape they had before so behavior is preserved
    -- if a stale row needs the boundary computed.
    WHEN '15m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 15 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 15)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 15) + 1)
      END
    WHEN '24h'::speed_duration THEN
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;

COMMENT ON FUNCTION _next_clean_boundary(speed_duration, TIMESTAMPTZ) IS
'0020: 5m + 1h are active. 15m / 24h kept for historical callers. 30s post-boundary tolerance eliminates the cron-roll gap.';

-- ───────────────────────────────────────────────────────────────────────
-- 2) speed_roll_markets — generate 5m + 1h only
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION speed_roll_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_enabled    NUMERIC;
  v_oracle_stale_secs NUMERIC;
  v_durations         speed_duration[];
  v_asset_row         RECORD;
  v_duration          speed_duration;
  v_oracle            speed_oracle_latest%ROWTYPE;
  v_existing_id       UUID;
  v_opens_at          TIMESTAMPTZ;
  v_closes_at         TIMESTAMPTZ;
  v_strike            DECIMAL;
  v_market_id         UUID;
  v_created_count     INTEGER := 0;
  v_skipped_count     INTEGER := 0;
  v_deferred_count    INTEGER := 0;
  v_created_markets   JSONB := '[]'::JSONB;
BEGIN
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 1) = 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'master_kill_active', 'created', 0);
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  -- 0020: only 5m + 1h are active. Mig 0014 used ['5m','15m','24h'].
  v_durations := ARRAY['5m', '1h']::speed_duration[];

  FOR v_asset_row IN SELECT id FROM speed_assets WHERE enabled = TRUE LOOP
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset_row.id;
    IF NOT FOUND
       OR EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      -- Skip if open future market already exists.
      SELECT id INTO v_existing_id FROM speed_markets
      WHERE asset = v_asset_row.id AND duration = v_duration AND status = 'open' AND closes_at > NOW()
      LIMIT 1;
      IF FOUND THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_opens_at := _next_clean_boundary(v_duration, NOW());
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '1h'::speed_duration THEN v_opens_at + INTERVAL '1 hour'
      END;

      -- 0014: strike must reflect the price AT opens_at, not at cron
      -- firing time. If opens_at is in the future, defer to the next
      -- cron beat — by then opens_at will have passed and the tick will
      -- exist.
      IF v_opens_at > NOW() THEN
        v_deferred_count := v_deferred_count + 1;
        CONTINUE;
      END IF;

      SELECT price INTO v_strike
      FROM speed_oracle_ticks
      WHERE asset = v_asset_row.id AND ts <= v_opens_at
      ORDER BY ts DESC
      LIMIT 1;

      -- Defensive: if no tick exists at-or-before opens_at, fall back to
      -- the live oracle. Better to create the market with a slightly-off
      -- strike than to skip indefinitely.
      IF v_strike IS NULL THEN
        v_strike := v_oracle.price;
      END IF;

      INSERT INTO speed_markets (asset, duration, opens_at, closes_at, strike_price, status, created_at)
      VALUES (v_asset_row.id, v_duration, v_opens_at, v_closes_at, v_strike, 'open', NOW())
      RETURNING id INTO v_market_id;

      v_created_count := v_created_count + 1;
      v_created_markets := v_created_markets || jsonb_build_object(
        'id', v_market_id,
        'asset', v_asset_row.id,
        'duration', v_duration,
        'opens_at', v_opens_at,
        'closes_at', v_closes_at,
        'strike', v_strike
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'created', v_created_count,
    'skipped', v_skipped_count,
    'deferred', v_deferred_count,
    'markets', v_created_markets
  );
END;
$$;

COMMENT ON FUNCTION speed_roll_markets() IS
'0020: cron-driven market creator. Generates 5m + 1h rounds at clean boundaries. Strike captured from tick-at-opens_at. Defers (no creation) when opens_at is in the future relative to firing time — picked up on the next cron beat.';

GRANT EXECUTE ON FUNCTION speed_roll_markets() TO PUBLIC;
