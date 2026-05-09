-- Sprint 4 Phase 5A (mig 0052): speed_roll_markets calls _speed_is_market_open
-- before opening any market for a given asset. For BTC the helper returns
-- TRUE (no schedule). For GOLD it returns FALSE during weekend gap +
-- daily 21:00-22:00 UTC break.
--
-- Existing open markets resolve normally regardless of this gate. Only NEW
-- market creation is gated.

CREATE OR REPLACE FUNCTION public.speed_roll_markets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_master_enabled    NUMERIC;
  v_oracle_stale_secs NUMERIC;
  v_1m_enabled        NUMERIC;
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

  -- Sprint 3 / mig 0046: 5m always active. 1m gated behind
  -- speed_1m_markets_enabled flag (default OFF) until Sprint 1 Phase 2
  -- refactors helpers to read per-market spread/soft-block/reject from
  -- speed_market_config. Without that, 1m markets would inherit 5m's
  -- global fee_config values (5% spread instead of 8% launch tax).
  -- Flip the flag to 1 after Phase 2 lands.
  SELECT rate INTO v_1m_enabled FROM fee_config WHERE fee_type = 'speed_1m_markets_enabled' LIMIT 1;
  IF COALESCE(v_1m_enabled, 0) = 1 THEN
    v_durations := ARRAY['5m', '1m']::speed_duration[];
  ELSE
    v_durations := ARRAY['5m']::speed_duration[];
  END IF;

  FOR v_asset_row IN SELECT id FROM speed_assets WHERE enabled = TRUE LOOP
    -- Sprint 4 (mig 0048): gate GOLD asset rolling behind speed_gold_markets_enabled
    IF v_asset_row.id = 'GOLD' AND COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_gold_markets_enabled' LIMIT 1), 0) = 0 THEN
      CONTINUE;
    END IF;
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset_row.id;
    IF NOT FOUND
       OR EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    -- 0052 Phase 5A: gate gold (and any future asset with trading hours)
    -- on _speed_is_market_open. BTC has no schedule → always TRUE.
    IF NOT _speed_is_market_open(v_asset_row.id, NOW()) THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      SELECT id INTO v_existing_id FROM speed_markets
      WHERE asset = v_asset_row.id AND duration = v_duration AND status = 'open' AND closes_at > NOW()
      LIMIT 1;
      IF FOUND THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_opens_at := _next_clean_boundary(v_duration, NOW());
      v_closes_at := CASE v_duration
        WHEN '1m'::speed_duration THEN v_opens_at + INTERVAL '1 minute'
        WHEN '5m'::speed_duration THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '1h'::speed_duration THEN v_opens_at + INTERVAL '1 hour'
      END;

      IF v_opens_at > NOW() THEN
        v_deferred_count := v_deferred_count + 1;
        CONTINUE;
      END IF;

      SELECT price INTO v_strike
      FROM speed_oracle_ticks
      WHERE asset = v_asset_row.id AND ts <= v_opens_at
      ORDER BY ts DESC
      LIMIT 1;

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
$function$;
COMMENT ON FUNCTION public.speed_roll_markets() IS
  $$0046 Sprint 3: opens 5m + 1m markets. 1h killed (legacy positions resolve normally). 1m markets open every minute on the boundary.$$;
GRANT EXECUTE ON FUNCTION public.speed_roll_markets() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.speed_roll_markets() TO sooqadmin;