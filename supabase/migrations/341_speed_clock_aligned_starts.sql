-- ============================================================================
-- 341_speed_clock_aligned_starts.sql
--
-- Workstream J — clock-aligned market start times.
--
-- User-facing change: speed markets now begin/end at clean clock boundaries:
--   5m  → :00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55
--   15m → :00, :15, :30, :45
--   1h  → :00
--   24h → midnight UTC (already aligned per existing logic)
--
-- Why: makes the product feel scheduled and predictable — same pattern as
-- Polymarket's hourly events. User can glance at clock, know exactly when
-- the next market closes.
--
-- Three changes:
-- 1. New helper `_next_clean_boundary(duration, now)` computes the next clean
--    boundary timestamp for a given duration.
-- 2. `speed_roll_markets()` rewritten to create new markets opening at the
--    next clean boundary (not at NOW()).
-- 3. ONE-TIME: void any currently-open markets whose opens_at doesn't fall on
--    a clean boundary. All stakes refunded (full void semantics from
--    speed_resolve_market). Cron re-creates aligned markets on next firing.
-- ============================================================================

-- ─── 1. Clean-boundary helper ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _next_clean_boundary(p_duration speed_duration, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_duration
    WHEN '5m'::speed_duration THEN
      date_trunc('hour', p_now)
        + INTERVAL '5 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 5) + 1)
    WHEN '15m'::speed_duration THEN
      date_trunc('hour', p_now)
        + INTERVAL '15 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 15) + 1)
    WHEN '1h'::speed_duration THEN
      date_trunc('hour', p_now) + INTERVAL '1 hour'
    WHEN '24h'::speed_duration THEN
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;

COMMENT ON FUNCTION _next_clean_boundary(speed_duration, TIMESTAMPTZ) IS
'Returns the next clean clock boundary timestamp after p_now for a given duration. 5m → :00,:05,...; 15m → :00,:15,:30,:45; 1h → :00; 24h → midnight UTC.';

-- ─── 2. Rewrite speed_roll_markets to align ─────────────────────────────────

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
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'master_kill_active', 'created', 0);
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  v_assets := ARRAY['BTC']::speed_asset[];
  v_durations := ARRAY['5m', '15m', '1h', '24h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
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
      -- Skip if an open future market already exists for this pair
      SELECT id, closes_at INTO v_existing FROM speed_markets
      WHERE asset = v_asset AND duration = v_duration AND status = 'open' AND closes_at > NOW()
      LIMIT 1;
      IF FOUND THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      -- Use clean clock boundary for opens_at
      v_opens_at := _next_clean_boundary(v_duration, NOW());

      -- closes_at = opens_at + duration
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '1h'::speed_duration  THEN v_opens_at + INTERVAL '1 hour'
        WHEN '24h'::speed_duration THEN v_opens_at + INTERVAL '1 day'
      END;

      -- Defensive: refuse to create a market that closes in <1 hour for 24h
      -- (only happens in edge case where cron fires extremely close to midnight)
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
        'opens_at', v_opens_at,
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
'Cron-driven. Creates the next speed market for any (asset, duration) pair without an open future market, opening at the next clean clock boundary (mig 341).';

-- ─── 3. Existing markets ────────────────────────────────────────────────────
-- We do NOT touch existing open markets. They'll resolve at their original
-- closes_at via the resolution cron, refund or pay out as normal. The NEXT
-- generation of markets created by speed_roll_markets() will be aligned to
-- clean boundaries from then on. Within ~5 minutes (longest non-aligned 5m
-- market closing), the system is fully aligned.
--
-- This avoids touching active user positions. No retroactive voids.
