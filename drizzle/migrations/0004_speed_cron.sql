-- 0004_speed_cron.sql — pg_cron + speed market lifecycle loops
--
-- Sooq v1 cron stack (pg_cron-driven, lives inside Postgres):
--   speed-resolve  every 5s  → speed_resolve_expired_markets()
--   speed-roll     every 5s  → speed_roll_markets()
--
-- v1 deltas vs prediction-market original:
--   * speed_asset enum is gone — `asset` is now TEXT referencing
--     speed_assets table (extensible for ETH/SOL later).
--   * No '1h' duration (Sooq is 5m/15m/24h only).
--   * No 'pending' status — eager strike capture at cron time. Tradeoff:
--     up to 5s of strike-staleness on creation. Acceptable v1 simplification.
--   * No partition management — speed_oracle_ticks is a flat table for v1.
--   * No log_system_event — RAISE NOTICE only.

CREATE EXTENSION IF NOT EXISTS pg_cron;

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. _next_clean_boundary helper
-- ═══════════════════════════════════════════════════════════════════

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
    WHEN '24h'::speed_duration THEN
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;

COMMENT ON FUNCTION _next_clean_boundary(speed_duration, TIMESTAMPTZ) IS
'Returns the next clean clock boundary for a duration. 5m → :00,:05,...; 15m → :00,:15,:30,:45; 24h → midnight UTC.';


-- ═══════════════════════════════════════════════════════════════════
-- 2. speed_roll_markets — create new markets at clean boundaries
-- ═══════════════════════════════════════════════════════════════════
--
-- Iterates enabled speed_assets × all 3 durations. For each pair, if no
-- open future market exists, inserts one with strike = current oracle price.
--
-- Master kill switch: fee_config row 'speed_markets_enabled' → 0 disables.
-- Oracle freshness gate: fee_config row 'speed_oracle_stale_seconds' (default 2s).

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
  v_market_id         UUID;
  v_created_count     INTEGER := 0;
  v_skipped_count     INTEGER := 0;
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

      INSERT INTO speed_markets (asset, duration, strike_price, opens_at, closes_at, status)
      VALUES (v_asset_row.id, v_duration, v_oracle.price, v_opens_at, v_closes_at, 'open')
      RETURNING id INTO v_market_id;

      v_created_count := v_created_count + 1;
      v_created_markets := v_created_markets || jsonb_build_object(
        'id', v_market_id,
        'asset', v_asset_row.id,
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


-- ═══════════════════════════════════════════════════════════════════
-- 3. speed_resolve_expired_markets — cron loop wrapper
-- ═══════════════════════════════════════════════════════════════════
--
-- Iterates expired open/resolving markets and calls speed_resolve_market().
-- Per-market errors are swallowed (logged via RAISE NOTICE) so one bad
-- market doesn't block others.

CREATE OR REPLACE FUNCTION speed_resolve_expired_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market_id UUID;
  v_result    JSONB;
  v_resolved  INTEGER := 0;
  v_voided    INTEGER := 0;
  v_failed    INTEGER := 0;
  v_errors    JSONB := '[]'::JSONB;
BEGIN
  FOR v_market_id IN
    SELECT id FROM speed_markets
    WHERE status IN ('open', 'resolving') AND closes_at <= NOW()
    ORDER BY closes_at
  LOOP
    BEGIN
      v_result := speed_resolve_market(v_market_id);

      IF COALESCE((v_result->>'voided')::BOOLEAN, FALSE) THEN
        v_voided := v_voided + 1;
      ELSIF COALESCE((v_result->>'success')::BOOLEAN, FALSE) THEN
        v_resolved := v_resolved + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('market_id', v_market_id, 'error', SQLERRM);
      RAISE NOTICE 'speed_resolve_expired_markets: market % failed: %', v_market_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'resolved', v_resolved,
    'voided', v_voided,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. Schedule pg_cron jobs (5s cadence)
-- ═══════════════════════════════════════════════════════════════════
--
-- Idempotent: drop existing 'speed-*' jobs first, then re-schedule.

DO $$
DECLARE
  v_jobname TEXT;
BEGIN
  FOR v_jobname IN SELECT jobname FROM cron.job WHERE jobname LIKE 'speed-%' LOOP
    PERFORM cron.unschedule(v_jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'speed-resolve',
  '5 seconds',
  $$SELECT speed_resolve_expired_markets();$$
);

SELECT cron.schedule(
  'speed-roll',
  '5 seconds',
  $$SELECT speed_roll_markets();$$
);

DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname LIKE 'speed-%';
  RAISE NOTICE 'pg_cron: % speed jobs scheduled', v_count;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Seed BTC speed asset + master config rows (idempotent)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO speed_assets (id, display_name, enabled)
VALUES ('BTC', 'Bitcoin', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_config (fee_type, rate, description)
VALUES
  ('speed_markets_enabled', 1, 'Master kill switch for speed market rolling. 0 = stop creating new markets.'),
  ('speed_oracle_stale_seconds', 2, 'Skip rolling new markets if last oracle tick is older than this.')
ON CONFLICT (fee_type) DO NOTHING;

COMMIT;
