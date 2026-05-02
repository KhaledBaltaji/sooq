-- ============================================================================
-- 328_speed_market_roll.sql
--
-- Creates the next set of speed markets for all (asset, duration) pairs
-- that don't have an open future market.
--
-- Designed to be called every minute by cron `/api/cron/speed-roll`.
--
-- Logic per (asset, duration):
--   - Find latest open market for that pair.
--   - If no open market with closes_at > NOW(): create next one.
--   - opens_at = NOW(), strike_price = current oracle spot.
--   - closes_at depends on duration:
--       5m  → opens_at + 5 min
--       15m → opens_at + 15 min
--       1h  → opens_at + 1 hour
--       24h → next midnight UTC (one per day; skipped if already created)
--
-- Master-kill respected: if `speed_markets_enabled = 0`, no new markets.
-- Stale oracle: rejects with NOTICE, retries next cron tick.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_roll_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_enabled    DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_assets            speed_asset[];
  v_durations         speed_duration[];
  v_asset             speed_asset;
  v_duration          speed_duration;
  v_oracle            RECORD;
  v_existing          RECORD;
  v_opens_at          TIMESTAMPTZ;
  v_closes_at         TIMESTAMPTZ;
  v_market_id         UUID;
  v_created_count     INTEGER := 0;
  v_skipped_count     INTEGER := 0;
  v_created_markets   JSONB := '[]'::JSONB;
BEGIN
  -- Master kill check
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'master_kill_active', 'created', 0);
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  v_assets := ARRAY['BTC']::speed_asset[];
  v_durations := ARRAY['5m', '15m', '1h', '24h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
    -- Oracle freshness per-asset
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset;
    IF v_oracle IS NULL THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;
    IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      -- Skip if there's already an open future market for this pair
      SELECT id, closes_at INTO v_existing FROM speed_markets
      WHERE asset = v_asset AND duration = v_duration AND status = 'open' AND closes_at > NOW()
      LIMIT 1;
      IF FOUND THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_opens_at := NOW();

      -- Compute closes_at per duration
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '1h'::speed_duration  THEN v_opens_at + INTERVAL '1 hour'
        WHEN '24h'::speed_duration THEN
          -- Next midnight UTC
          (date_trunc('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC'
      END;

      -- For 24h: if next midnight is < 1 hour from now, push to the day after
      -- (avoid creating a market that closes in 30 sec)
      IF v_duration = '24h' AND v_closes_at - NOW() < INTERVAL '1 hour' THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      INSERT INTO speed_markets (
        asset, duration, strike_price, opens_at, closes_at, status
      ) VALUES (
        v_asset, v_duration, v_oracle.price, v_opens_at, v_closes_at, 'open'
      )
      RETURNING id INTO v_market_id;

      v_created_count := v_created_count + 1;
      v_created_markets := v_created_markets || jsonb_build_object(
        'id', v_market_id,
        'asset', v_asset,
        'duration', v_duration,
        'strike_price', v_oracle.price,
        'closes_at', v_closes_at
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'created', v_created_count,
    'skipped', v_skipped_count,
    'markets', v_created_markets
  );
END;
$$;

COMMENT ON FUNCTION speed_roll_markets() IS
'Cron-driven RPC. Creates the next speed market for any (asset, duration) pair without an open future market. Respects master kill + oracle freshness.';
