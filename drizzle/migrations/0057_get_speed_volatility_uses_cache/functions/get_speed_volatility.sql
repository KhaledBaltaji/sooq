-- ============================================================================
-- get_speed_volatility — mig 0057 rewrite
-- ============================================================================
--
-- Two overloads:
--   - (p_asset text)                              → existing callsite
--   - (p_asset text, p_duration speed_duration)   → preferred new callsite
--
-- The (text) overload delegates to (text, '5m'::speed_duration) so existing
-- callers don't break. Both overloads return identical shape:
--   { rv: numeric, computed_at: timestamptz, source: 'cache' | 'fallback' }
--
-- `source` reflects what _speed_get_iv actually returned:
--   - 'cache'     : speed_volatility_cache row was found AND fresh (within
--                   speed_iv_freshness_<horizon>_secs window)
--   - 'fallback'  : row was missing OR stale; fell through to
--                   fee_config.speed_iv_<asset> (or speed_iv_btc for BTC).
--
-- This makes client + server share the SAME IV source — eliminating the
-- 214% drift that was rejecting every 5m trade with IV_DRIFT.

-- Drop the old single-arg stub first so REPLACE creates the new body.
DROP FUNCTION IF EXISTS public.get_speed_volatility(text);

-- 2-arg variant: NO default on p_duration. Defaults on overloaded
-- functions create ambiguity in PG ("function is not unique" when called
-- with the prefix-matching signature). Callers must pass duration
-- explicitly; the 1-arg variant below handles "no duration" callers by
-- delegating to (text, '5m'::speed_duration).
CREATE OR REPLACE FUNCTION public.get_speed_volatility(
  p_asset text,
  p_duration speed_duration
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_horizon         TEXT;
  v_rv              NUMERIC;
  v_cache_row       RECORD;
  v_cache_age_secs  DOUBLE PRECISION;
  v_freshness_secs  DECIMAL;
  v_source          TEXT;
  v_computed_at     TIMESTAMPTZ;
BEGIN
  v_horizon := p_duration::TEXT;

  -- Value: delegate to _speed_get_iv so client + server agree.
  v_rv := _speed_get_iv(p_asset, p_duration);

  -- Determine source by inspecting cache freshness independently. The
  -- helper itself encapsulates the fall-through logic; we replicate the
  -- freshness check here purely for the source label.
  SELECT * INTO v_cache_row
  FROM speed_volatility_cache
  WHERE asset = p_asset AND horizon = v_horizon;

  IF v_cache_row IS NOT NULL THEN
    v_cache_age_secs := EXTRACT(EPOCH FROM (NOW() - v_cache_row.computed_at));

    SELECT rate INTO v_freshness_secs
    FROM fee_config
    WHERE fee_type = 'speed_iv_freshness_' || v_horizon || '_secs';
    v_freshness_secs := COALESCE(v_freshness_secs, 60);

    IF v_cache_age_secs <= v_freshness_secs THEN
      v_source := 'cache';
      v_computed_at := v_cache_row.computed_at;
    ELSE
      v_source := 'fallback';
      v_computed_at := NOW();
    END IF;
  ELSE
    v_source := 'fallback';
    v_computed_at := NOW();
  END IF;

  RETURN jsonb_build_object(
    'rv', v_rv,
    'computed_at', v_computed_at,
    'source', v_source
  );
END;
$function$;

-- Backward-compat overload — accepts asset only, defaults to 5m horizon.
-- This is the signature the existing `/api/speed/volatility` route was
-- already calling: SELECT get_speed_volatility(${asset}::text).
CREATE OR REPLACE FUNCTION public.get_speed_volatility(p_asset text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.get_speed_volatility(p_asset, '5m'::speed_duration);
$function$;

COMMENT ON FUNCTION public.get_speed_volatility(text, speed_duration) IS
  $$0057: delegates to _speed_get_iv so client + server share IV source. Returns { rv, computed_at, source: 'cache'|'fallback' }. Default duration 5m for the single-arg overload.$$;

COMMENT ON FUNCTION public.get_speed_volatility(text) IS
  $$0057: backward-compat overload. Calls (text, '5m'::speed_duration) variant.$$;

GRANT EXECUTE ON FUNCTION public.get_speed_volatility(text, speed_duration) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_speed_volatility(text, speed_duration) TO sooqadmin;
GRANT EXECUTE ON FUNCTION public.get_speed_volatility(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_speed_volatility(text) TO sooqadmin;
