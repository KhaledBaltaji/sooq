-- _speed_is_market_open(asset TEXT, ts_utc TIMESTAMPTZ)
--
-- Returns TRUE if the asset's market is open at the given UTC timestamp,
-- FALSE if closed. Reads `trading_hours_json` from speed_asset_config.
--
-- Schedule formats supported:
--   { schedule: 'always_open' }                    → always TRUE (BTC default)
--   { schedule: 'cme_xau_aligned',                 → real gold hours
--     weekly_open_utc: 'Sun 22:00',
--     weekly_close_utc: 'Fri 21:00',
--     daily_break_utc: '21:00-22:00' }
--
-- For 'cme_xau_aligned':
--   Weekly window: Sunday 22:00 UTC → Friday 21:00 UTC (open)
--   Daily break: 21:00 UTC → 22:00 UTC (closed every weekday)
--   Saturday all day: closed
--   Sunday before 22:00: closed
--
-- This is also used by:
--   - speed_roll_markets (skip creating markets when closed)
--   - /api/speed/quote (return is_open + next_open_at to frontend countdown)
--   - frontend MarketClosedCountdown component (reads quote response)

CREATE OR REPLACE FUNCTION public._speed_is_market_open(
  p_asset text,
  p_ts_utc timestamptz DEFAULT NOW()
)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hours_json jsonb;
  v_schedule   text;
  v_dow        int;     -- ISO day of week: 1=Monday, 7=Sunday
  v_hour       int;
  v_minute     int;
BEGIN
  SELECT trading_hours_json INTO v_hours_json
  FROM speed_asset_config
  WHERE asset = p_asset;

  -- No row OR no schedule → default open (24/7) — backward-compat for BTC
  IF v_hours_json IS NULL THEN
    RETURN TRUE;
  END IF;

  v_schedule := v_hours_json->>'schedule';
  IF v_schedule IS NULL OR v_schedule = 'always_open' THEN
    RETURN TRUE;
  END IF;

  IF v_schedule = 'cme_xau_aligned' THEN
    -- Compute UTC components from p_ts_utc
    v_dow    := EXTRACT(ISODOW FROM p_ts_utc AT TIME ZONE 'UTC')::int;
    v_hour   := EXTRACT(HOUR FROM p_ts_utc AT TIME ZONE 'UTC')::int;
    v_minute := EXTRACT(MINUTE FROM p_ts_utc AT TIME ZONE 'UTC')::int;

    -- Saturday (ISO 6): closed all day
    IF v_dow = 6 THEN
      RETURN FALSE;
    END IF;

    -- Sunday (ISO 7): closed until 22:00 UTC
    IF v_dow = 7 THEN
      IF v_hour < 22 THEN RETURN FALSE; END IF;
      RETURN TRUE;
    END IF;

    -- Friday (ISO 5): closed at/after 21:00 UTC
    IF v_dow = 5 THEN
      IF v_hour >= 21 THEN RETURN FALSE; END IF;
      -- Daily break still applies before 21
      IF v_hour = 21 THEN RETURN FALSE; END IF;
      RETURN TRUE;
    END IF;

    -- Monday–Thursday (ISO 1-4): closed during 21:00-22:00 UTC daily break
    IF v_hour = 21 THEN RETURN FALSE; END IF;

    RETURN TRUE;
  END IF;

  -- Unknown schedule string — fail safe and assume closed.
  RAISE WARNING '_speed_is_market_open: unknown schedule % for asset %, defaulting to closed', v_schedule, p_asset;
  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION public._speed_is_market_open(text, timestamptz) IS
  '0052 Phase 5A: returns TRUE if asset is in trading hours. Reads speed_asset_config.trading_hours_json. Backward-compat: NULL/missing JSON → always open. Used by speed_roll_markets to gate market creation, and by /api/speed/quote to show a frontend countdown when closed.';

GRANT EXECUTE ON FUNCTION public._speed_is_market_open(text, timestamptz) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_is_market_open(text, timestamptz) TO sooqadmin;

-- Companion: returns the NEXT timestamp when the market reopens, NULL if
-- already open. Used by the quote endpoint to power the frontend countdown.

CREATE OR REPLACE FUNCTION public._speed_next_open_at(
  p_asset text,
  p_ts_utc timestamptz DEFAULT NOW()
)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hours_json jsonb;
  v_schedule   text;
  v_dow        int;
  v_hour       int;
  v_date       date;
  v_candidate  timestamptz;
BEGIN
  -- If already open, return NULL
  IF _speed_is_market_open(p_asset, p_ts_utc) THEN
    RETURN NULL;
  END IF;

  SELECT trading_hours_json INTO v_hours_json
  FROM speed_asset_config WHERE asset = p_asset;

  v_schedule := COALESCE(v_hours_json->>'schedule', 'always_open');
  IF v_schedule = 'always_open' OR v_schedule IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_schedule = 'cme_xau_aligned' THEN
    v_dow  := EXTRACT(ISODOW FROM p_ts_utc AT TIME ZONE 'UTC')::int;
    v_hour := EXTRACT(HOUR FROM p_ts_utc AT TIME ZONE 'UTC')::int;
    v_date := (p_ts_utc AT TIME ZONE 'UTC')::date;

    -- Saturday → next open is Sunday 22:00 UTC
    IF v_dow = 6 THEN
      RETURN ((v_date + 1)::text || ' 22:00:00')::timestamptz;
    END IF;

    -- Sunday before 22:00 → today 22:00 UTC
    IF v_dow = 7 AND v_hour < 22 THEN
      RETURN (v_date::text || ' 22:00:00')::timestamptz;
    END IF;

    -- Friday at/after 21:00 → next open Sunday 22:00 UTC
    IF v_dow = 5 AND v_hour >= 21 THEN
      -- Add 2 days (Fri → Sun); date + integer = date (not timestamp)
      RETURN ((v_date + 2)::text || ' 22:00:00')::timestamptz;
    END IF;

    -- Mon-Thu daily break (21:00-22:00) → today 22:00 UTC
    IF v_hour = 21 THEN
      RETURN (v_date::text || ' 22:00:00')::timestamptz;
    END IF;

    -- Fallback (shouldn't reach here if is_market_open returned FALSE correctly)
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public._speed_next_open_at(text, timestamptz) IS
  '0052 Phase 5A: returns next open timestamp for the asset, or NULL if currently open or schedule is always_open. Used by /api/speed/quote to power the frontend MarketClosedCountdown component.';

GRANT EXECUTE ON FUNCTION public._speed_next_open_at(text, timestamptz) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_next_open_at(text, timestamptz) TO sooqadmin;
