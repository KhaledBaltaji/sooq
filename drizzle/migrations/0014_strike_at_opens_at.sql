-- 0014_strike_at_opens_at.sql
--
-- Khaled spotted that the strike (target) didn't match the price at the
-- labeled opens_at second. Root cause:
--
--   `speed_roll_markets` snapshotted `v_oracle.price` (the live oracle at
--   cron firing time) and inserted it as the new market's strike. But
--   `opens_at` is computed from `_next_clean_boundary(NOW())`, which can
--   land up to 5 minutes BEFORE NOW (next-strict path) or up to 30s AFTER
--   NOW (post-anchor tolerance from mig 0011). Either way, the strike
--   captured the price at firing time, NOT at opens_at.
--
-- Fix: use the historical tick at-or-just-before `opens_at` as the strike.
-- Two cases:
--   a) opens_at <= NOW (post-anchor) → speed_oracle_ticks already has the
--      tick at that second. Strike captures the actual price at opens_at.
--   b) opens_at > NOW (next-future) → no tick yet; defer creation by one
--      cron tick. Cron fires every 5s anyway, so by the time opens_at
--      passes, the next firing will create the market with the right
--      tick. Worst-case latency: 5 seconds after opens_at (one cron beat).
--
-- The market's labeled opens_at second now lines up with the price the
-- chart displays at that moment. No more "target was set when price
-- dipped at 14:59:30 but market labeled 15:00 open."

BEGIN;

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

  v_durations := ARRAY['5m', '15m', '24h']::speed_duration[];

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
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '24h'::speed_duration THEN v_opens_at + INTERVAL '1 day'
      END;

      -- Defensive: refuse 24h windows shorter than 1 hour (cron timing edge).
      IF v_duration = '24h' AND v_closes_at - NOW() < INTERVAL '1 hour' THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      -- 0014: strike must reflect the price AT opens_at, not at cron
      -- firing time. If opens_at is in the past (post-anchor case), look
      -- up the historical tick. If it's in the future, defer to the next
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

      -- Defensive: if no tick exists at-or-before opens_at (extremely
      -- unlikely given the freshness gate already passed), fall back to
      -- the live oracle. Better to create the market with a slightly-off
      -- strike than to skip indefinitely.
      IF v_strike IS NULL THEN
        v_strike := v_oracle.price;
      END IF;

      INSERT INTO speed_markets (asset, duration, strike_price, opens_at, closes_at, status)
      VALUES (v_asset_row.id, v_duration, v_strike, v_opens_at, v_closes_at, 'open')
      RETURNING id INTO v_market_id;

      v_created_count := v_created_count + 1;
      v_created_markets := v_created_markets || jsonb_build_object(
        'id', v_market_id,
        'asset', v_asset_row.id,
        'duration', v_duration,
        'strike_price', v_strike,
        'opens_at', v_opens_at,
        'closes_at', v_closes_at
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

COMMIT;
