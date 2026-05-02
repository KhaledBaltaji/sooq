-- ============================================================================
-- 329_speed_resolve_expired.sql
--
-- Wrapper RPC for cron to resolve all expired speed markets.
--
-- Designed to be called every minute by `/api/cron/speed-resolve`.
--
-- Logic:
--   - Find all markets with status='open' AND closes_at <= NOW().
--   - For each: call speed_resolve_market(id).
--   - Aggregate results.
--
-- speed_resolve_market is itself idempotent (advisory lock + per-position
-- UNIQUE), so concurrent cron firings or retries are safe.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_resolve_expired_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market         RECORD;
  v_result         JSONB;
  v_results        JSONB := '[]'::JSONB;
  v_resolved       INTEGER := 0;
  v_voided         INTEGER := 0;
  v_failed         INTEGER := 0;
  v_errors         JSONB := '[]'::JSONB;
BEGIN
  FOR v_market IN
    SELECT id FROM speed_markets
    WHERE status IN ('open', 'resolving') AND closes_at <= NOW()
    ORDER BY closes_at
  LOOP
    BEGIN
      v_result := speed_resolve_market(v_market.id);

      IF (v_result->>'voided')::BOOLEAN THEN
        v_voided := v_voided + 1;
      ELSIF (v_result->>'success')::BOOLEAN THEN
        v_resolved := v_resolved + 1;
      END IF;

      v_results := v_results || jsonb_build_object('market_id', v_market.id, 'result', v_result);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'market_id', v_market.id,
        'error', SQLERRM
      );
      PERFORM log_system_event(
        'error'::log_severity, 'speed_cron',
        'Failed to resolve market ' || v_market.id || ': ' || SQLERRM,
        jsonb_build_object('market_id', v_market.id, 'error', SQLERRM)
      );
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

COMMENT ON FUNCTION speed_resolve_expired_markets() IS
'Cron-driven RPC. Finds all expired open/resolving markets and resolves them. Idempotent via speed_resolve_market advisory lock.';


-- ── Partition extender ─────────────────────────────────────────────────
-- Called weekly to ensure speed_trades + speed_pool_ledger have partitions
-- for the next 14 days. IF NOT EXISTS in helper makes it idempotent.

CREATE OR REPLACE FUNCTION speed_extend_partitions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INTEGER;
  v_count INTEGER := 0;
BEGIN
  FOR i IN 0..13 LOOP
    PERFORM _speed_create_trade_partitions((CURRENT_DATE + i)::DATE);
    PERFORM _speed_create_pool_partitions((CURRENT_DATE + i)::DATE);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'days_ensured', v_count);
END;
$$;

COMMENT ON FUNCTION speed_extend_partitions() IS
'Cron-driven RPC. Ensures partitions exist for next 14 days on speed_trades + speed_pool_ledger. Run weekly.';
