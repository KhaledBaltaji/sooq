-- ============================================================================
-- _speed_get_iv — mig 0056 update
-- ============================================================================
--
-- Identical to the 0029 / 0039 (S0.12) canonical, with one change:
--   Line 26 of canonical: IF v_horizon NOT IN ('5m','1h','15m','24h')
--   becomes              : IF v_horizon NOT IN ('1m','5m','15m','1h','24h')
--
-- Everything else byte-equivalent.

CREATE OR REPLACE FUNCTION public._speed_get_iv(p_asset text, p_duration speed_duration)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_horizon         TEXT;
  v_cache_row       RECORD;
  v_cache_age_secs  DOUBLE PRECISION;
  v_freshness_secs  DECIMAL;
  v_fail_closed     DECIMAL;
  v_fallback        DECIMAL;
  v_fallback_key    TEXT;
BEGIN
  v_horizon := p_duration::TEXT;
  IF v_horizon NOT IN ('1m','5m','15m','1h','24h') THEN
    RAISE EXCEPTION 'No volatility horizon mapping for duration %', p_duration;
  END IF;

  SELECT * INTO v_cache_row
  FROM speed_volatility_cache
  WHERE asset = p_asset AND horizon = v_horizon;

  SELECT rate INTO v_fail_closed
  FROM fee_config WHERE fee_type = 'speed_iv_fail_closed';
  v_fail_closed := COALESCE(v_fail_closed, 0);

  IF v_cache_row IS NOT NULL THEN
    v_cache_age_secs := EXTRACT(EPOCH FROM (NOW() - v_cache_row.computed_at));

    SELECT rate INTO v_freshness_secs
    FROM fee_config
    WHERE fee_type = 'speed_iv_freshness_' || v_horizon || '_secs';
    v_freshness_secs := COALESCE(v_freshness_secs, 60);

    IF v_cache_age_secs <= v_freshness_secs THEN
      RETURN v_cache_row.sigma_annualized;
    END IF;

    IF v_fail_closed > 0 THEN
      RAISE EXCEPTION 'IV_MISSING: cache stale for % %: % seconds old (max %s)',
        p_asset, v_horizon, ROUND(v_cache_age_secs::NUMERIC, 1), v_freshness_secs
        USING HINT = 'Oracle worker may be down. Check /api/health/oracle.';
    END IF;
  ELSIF v_fail_closed > 0 THEN
    RAISE EXCEPTION 'IV_MISSING: cache empty for % % and fail-closed mode is on',
      p_asset, v_horizon
      USING HINT = 'Oracle worker has not yet populated cache.';
  END IF;

  -- S0.12: asset-aware fallback. Try speed_iv_<asset> first.
  v_fallback_key := 'speed_iv_' || lower(p_asset);
  SELECT rate INTO v_fallback
  FROM fee_config WHERE fee_type = v_fallback_key;

  -- Fall through to speed_iv_btc only if asset-specific not configured AND
  -- asset is BTC (preserves backward compat; never silently uses BTC's IV
  -- for a non-BTC asset).
  IF v_fallback IS NULL AND lower(p_asset) = 'btc' THEN
    SELECT rate INTO v_fallback FROM fee_config WHERE fee_type = 'speed_iv_btc';
  END IF;

  -- S0.12: refuse to return NULL or non-positive IV. BSM math relies on
  -- positive sigma; 0 produces division by zero, NULL silently propagates.
  IF v_fallback IS NULL THEN
    RAISE EXCEPTION 'IV_MISSING: no fallback IV configured for asset % (key %)',
      p_asset, v_fallback_key
      USING HINT = format('Set fee_config.%s to a positive annualized vol (e.g. 0.6)', v_fallback_key);
  END IF;
  IF v_fallback <= 0 THEN
    RAISE EXCEPTION 'IV_MISSING: configured fallback for % is non-positive (% in fee_config.%s)',
      p_asset, v_fallback, v_fallback_key
      USING HINT = 'Annualized vol must be > 0';
  END IF;

  RETURN v_fallback;
END;
$function$;

COMMENT ON FUNCTION public._speed_get_iv(p_asset text, p_duration speed_duration) IS
  $$0056: allow duration 1m (was missing from 0029 horizon list, blocked all 1m trades). Otherwise byte-equivalent to 0039 S0.12.$$;

GRANT EXECUTE ON FUNCTION public._speed_get_iv(p_asset text, p_duration speed_duration) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_get_iv(p_asset text, p_duration speed_duration) TO sooqadmin;
