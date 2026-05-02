-- ============================================================================
-- 347_speed_roll_back_to_back.sql
--
-- Speed-market roll: every clean boundary gets its own market. Closes the
-- 5-min dead window between consecutive 5m markets (and equivalents for
-- 15m / 1h) introduced by mig 341 + 328's "skip if any future-open" logic.
--
-- Three changes (see plan: Part 2 — Backend in
-- /Users/khaledbaltaji/.claude/plans/this-frontend-is-still-glittery-sprout.md):
--
-- 1. Pre-flight DO block — hard-fail if any historical duplicate
--    (asset, duration, opens_at) row exists. Surfaces dirty data before
--    schema change.
-- 2. CREATE UNIQUE INDEX CONCURRENTLY on (asset, duration, opens_at), then
--    ATTACH as constraint via ALTER TABLE ... USING INDEX. CONCURRENTLY
--    avoids the ACCESS EXCLUSIVE lock that a plain ADD CONSTRAINT UNIQUE
--    would take, so trades / resolutions keep flowing during deploy.
-- 3. CREATE OR REPLACE speed_roll_markets() — replaces the "skip if any
--    future-open market exists" check with INSERT ... ON CONFLICT DO NOTHING
--    against the next clean boundary. Race-safe via the new constraint.
--
-- Strike-price semantics unchanged: oracle price at the moment of cron call
-- is used as the strike for the upcoming market (gap shrinks from minutes
-- under mig 341 to ~one minute now). speed_execute_trade still gates trades
-- on `NOW() >= opens_at` (mig 340), so users cannot trade against an
-- upcoming market.
-- ============================================================================

-- ─── 1. Pre-flight: hard-fail if any historical duplicate exists ───────────
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT asset, duration, opens_at
    FROM speed_markets
    GROUP BY asset, duration, opens_at
    HAVING COUNT(*) > 1
  ) sub;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique index: % duplicate (asset, duration, opens_at) groups exist — resolve manually first',
      v_dup_count;
  END IF;
END $$;

-- ─── 2. Build the unique index ─────────────────────────────────────────────
-- NOTE: Supabase migrations run inside a pipeline transaction, which forbids
-- CREATE INDEX CONCURRENTLY. speed_markets is small (~10-15k rows on
-- staging), so a plain CREATE INDEX takes a sub-second AccessExclusive lock.
-- Acceptable on staging; revisit if production cardinality changes.
-- Idempotent via IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS
  speed_markets_asset_duration_opens_at_uq_idx
  ON speed_markets (asset, duration, opens_at);

-- ─── 3. Attach the index as a constraint (sub-ms metadata change) ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'speed_markets_asset_duration_opens_at_uq'
  ) THEN
    ALTER TABLE speed_markets
      ADD CONSTRAINT speed_markets_asset_duration_opens_at_uq
      UNIQUE USING INDEX speed_markets_asset_duration_opens_at_uq_idx;
  END IF;
END $$;

COMMENT ON CONSTRAINT speed_markets_asset_duration_opens_at_uq ON speed_markets IS
  'Race guard for speed_roll_markets — at most one market per (asset, duration) at any clean clock boundary.';

-- ─── 4. Rewrite speed_roll_markets to check opens_at = next_boundary ───────
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

  v_assets    := ARRAY['BTC']::speed_asset[];
  v_durations := ARRAY['5m', '15m', '1h', '24h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset;
    IF v_oracle IS NULL
       OR EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      v_opens_at := _next_clean_boundary(v_duration, NOW());
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '1h'::speed_duration  THEN v_opens_at + INTERVAL '1 hour'
        WHEN '24h'::speed_duration THEN v_opens_at + INTERVAL '1 day'
      END;

      -- 24h defensive guard preserved from mig 341
      IF v_duration = '24h' AND v_closes_at - NOW() < INTERVAL '1 hour' THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_market_id := NULL;

      INSERT INTO speed_markets (
        asset, duration, strike_price, opens_at, closes_at, status
      ) VALUES (
        v_asset, v_duration, v_oracle.price, v_opens_at, v_closes_at, 'open'
      )
      ON CONFLICT (asset, duration, opens_at) DO NOTHING
      RETURNING id INTO v_market_id;

      IF v_market_id IS NULL THEN
        v_skipped_count := v_skipped_count + 1;
      ELSE
        v_created_count := v_created_count + 1;
        v_created_markets := v_created_markets || jsonb_build_object(
          'id',        v_market_id,
          'asset',     v_asset,
          'duration',  v_duration,
          'opens_at',  v_opens_at,
          'closes_at', v_closes_at
        );
      END IF;
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
  'Cron entrypoint. Ensures a market exists at the next clean boundary for every (asset, duration). Race-safe via INSERT ... ON CONFLICT on speed_markets_asset_duration_opens_at_uq. Replaces the mig-341 / mig-328 "skip if any future-open" check that left 5-min dead windows between consecutive markets.';
