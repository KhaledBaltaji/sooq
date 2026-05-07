-- ============================================================================
-- Mig 0036: extend _speed_pricing_apply with telemetry write
-- ============================================================================
--
-- Changes vs the canonical version (drizzle/functions/_speed_pricing_apply.sql):
--   1. STABLE → VOLATILE (postgres requires this once we INSERT)
--   2. New parameter `p_market_id UUID DEFAULT NULL` at the end. Backward-
--      compatible — all existing callers (speed_execute_trade,
--      speed_execute_cashout, /api/speed/quote LATERAL JOIN) use positional
--      args and will pass NULL by omission until updated.
--   3. New tracking variable v_matrix_p_raw — the raw matrix probability
--      BEFORE asymmetric only-push-up. Lets analytics see the actual
--      correction size (matrix - BSM) regardless of which one wins.
--   4. New tracking variable v_neighbor_used — true when the current cell
--      didn't qualify but the neighbor-aware fallback engaged.
--   5. Telemetry INSERT at the very end, wrapped in BEGIN/EXCEPTION WHEN
--      OTHERS THEN NULL so any failure (NOT NULL, table dropped, etc.)
--      silently swallows and never blocks the calling RPC. CRITICAL: the
--      RETURN QUERY happens BEFORE the telemetry block, so even if INSERT
--      hangs/blocks, the function still returns its result first.
--
-- Wait — RETURN QUERY in plpgsql actually queues the result tuple but
-- doesn't return until the function completes. So the telemetry block
-- runs WITHIN the same execution as the result computation. That's fine
-- as long as the EXCEPTION block is bullet-proof.

CREATE OR REPLACE FUNCTION public._speed_pricing_apply(
  p_asset            text,
  p_duration         speed_duration,
  p_side             text,
  p_dist_pct         double precision,
  p_secs_left        double precision,
  p_bsm_prob_side    double precision,
  p_widened_spread   double precision,
  p_mode             text,
  p_market_id        uuid DEFAULT NULL
)
 RETURNS TABLE(mark_prob double precision, offered_prob double precision, matrix_used boolean, matrix_version integer, soft_blocked boolean)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matrix_enabled    DECIMAL;
  v_asym_enabled      DECIMAL;
  v_soft_block_on     DECIMAL;
  v_soft_block_thresh DECIMAL;
  v_lookup            RECORD;
  v_matrix_p_over     DOUBLE PRECISION;
  v_matrix_p_side     DOUBLE PRECISION;
  v_matrix_p_raw      DOUBLE PRECISION;  -- 0036: track raw matrix prob (before push-up) for telemetry
  v_final_mark_prob   DOUBLE PRECISION;
  v_final_offered     DOUBLE PRECISION;
  v_used_matrix       BOOLEAN := FALSE;
  v_neighbor_used     BOOLEAN := FALSE;  -- 0036: track neighbor-aware fallback for telemetry
  v_version           INTEGER := NULL;
  v_blocked           BOOLEAN := FALSE;
  v_d_idx             SMALLINT;
  v_t_idx             SMALLINT;
  v_active_version    INTEGER;
  v_neighbor_p_over   DOUBLE PRECISION;
  v_neighbor_p_side   DOUBLE PRECISION;
BEGIN
  SELECT rate INTO v_matrix_enabled FROM fee_config WHERE fee_type = 'speed_pricing_matrix_enabled' LIMIT 1;
  SELECT rate INTO v_asym_enabled   FROM fee_config WHERE fee_type = 'speed_pricing_asym_pushup_enabled' LIMIT 1;
  v_matrix_enabled := COALESCE(v_matrix_enabled, 0);
  v_asym_enabled := COALESCE(v_asym_enabled, 1);

  -- Default to BSM
  v_final_mark_prob := p_bsm_prob_side;

  IF v_matrix_enabled = 1 THEN
    -- Resolve the active version once so neighbor queries below work even
    -- when the current cell has no row in the matrix table.
    SELECT id INTO v_active_version
    FROM speed_pricing_matrix_versions
    WHERE asset = p_asset AND duration = p_duration AND status = 'active'
    ORDER BY computed_at DESC LIMIT 1;

    -- Bucketize current state (mirrors _speed_matrix_lookup).
    -- Inlined here (not via _speed_matrix_lookup) so we have v_d_idx/v_t_idx
    -- for the neighbor query below.
    v_d_idx := CASE
      WHEN p_dist_pct <= -0.005 THEN 0
      WHEN p_dist_pct <= -0.003 THEN 1
      WHEN p_dist_pct <= -0.002 THEN 2
      WHEN p_dist_pct <= -0.001 THEN 3
      WHEN p_dist_pct <= -0.0005 THEN 4
      WHEN p_dist_pct <  0       THEN 5
      WHEN p_dist_pct <  0.0005  THEN 6
      WHEN p_dist_pct <  0.001   THEN 7
      WHEN p_dist_pct <  0.002   THEN 8
      WHEN p_dist_pct <  0.003   THEN 9
      WHEN p_dist_pct <  0.005   THEN 10
      ELSE 11
    END;
    v_t_idx := CASE
      WHEN p_secs_left <= 15  THEN 0
      WHEN p_secs_left <= 30  THEN 1
      WHEN p_secs_left <= 60  THEN 2
      WHEN p_secs_left <= 120 THEN 3
      WHEN p_secs_left <= 180 THEN 4
      WHEN p_secs_left <= 240 THEN 5
      ELSE 6
    END;

    SELECT * INTO v_lookup
    FROM _speed_matrix_lookup(p_asset, p_duration, p_dist_pct, p_secs_left)
    LIMIT 1;

    IF v_lookup.qualifies THEN
      v_used_matrix := TRUE;
      v_version := v_active_version;

      -- Matrix stores P(over wins). Convert to side-relevant.
      v_matrix_p_over := v_lookup.p_over;
      IF p_side = 'over' THEN
        v_matrix_p_side := v_matrix_p_over;
      ELSE
        v_matrix_p_side := 1.0 - v_matrix_p_over;
      END IF;
      v_matrix_p_raw := v_matrix_p_side;  -- 0036: capture for telemetry

      IF v_asym_enabled = 1 THEN
        -- Asymmetric only-push-up: matrix can only RAISE the price.
        v_final_mark_prob := GREATEST(p_bsm_prob_side, v_matrix_p_side);
      ELSE
        -- Symmetric matrix (full replacement of BSM)
        v_final_mark_prob := v_matrix_p_side;
      END IF;
    ELSE
      -- Neighbor-aware fallback (0034 post-codex direction-matching fix).
      IF p_side = 'over' THEN
        SELECT MAX(p_over_final) INTO v_neighbor_p_over
        FROM speed_pricing_matrix
        WHERE version_id = v_active_version
          AND asset = p_asset AND duration = p_duration
          AND time_bucket = v_t_idx
          AND dist_bucket <= v_d_idx
          AND qualifies = TRUE;
        IF v_neighbor_p_over IS NOT NULL THEN
          v_neighbor_p_side := v_neighbor_p_over;
          v_used_matrix := TRUE;
          v_neighbor_used := TRUE;  -- 0036: telemetry hint
          v_version := v_active_version;
          v_matrix_p_raw := v_neighbor_p_side;  -- 0036: neighbor value used as the raw matrix probability for telemetry
          IF v_asym_enabled = 1 THEN
            v_final_mark_prob := GREATEST(p_bsm_prob_side, v_neighbor_p_side);
          ELSE
            v_final_mark_prob := v_neighbor_p_side;
          END IF;
        END IF;
      ELSE
        SELECT MIN(p_over_final) INTO v_neighbor_p_over
        FROM speed_pricing_matrix
        WHERE version_id = v_active_version
          AND asset = p_asset AND duration = p_duration
          AND time_bucket = v_t_idx
          AND dist_bucket >= v_d_idx
          AND qualifies = TRUE;
        IF v_neighbor_p_over IS NOT NULL THEN
          v_neighbor_p_side := 1.0 - v_neighbor_p_over;
          v_used_matrix := TRUE;
          v_neighbor_used := TRUE;
          v_version := v_active_version;
          v_matrix_p_raw := v_neighbor_p_side;
          IF v_asym_enabled = 1 THEN
            v_final_mark_prob := GREATEST(p_bsm_prob_side, v_neighbor_p_side);
          ELSE
            v_final_mark_prob := v_neighbor_p_side;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Compute offered_prob (entry mode adds spread; cashout uses mark directly)
  IF p_mode = 'entry' THEN
    v_final_offered := v_final_mark_prob + p_widened_spread / 2.0;

    -- Check soft-block (entry only)
    SELECT rate INTO v_soft_block_on FROM fee_config WHERE fee_type = 'speed_entry_soft_block_enabled' LIMIT 1;
    SELECT rate INTO v_soft_block_thresh FROM fee_config WHERE fee_type = 'speed_entry_soft_block_threshold' LIMIT 1;
    v_soft_block_on := COALESCE(v_soft_block_on, 0);
    v_soft_block_thresh := COALESCE(v_soft_block_thresh, 0.95);

    IF v_soft_block_on = 1 AND v_final_offered >= v_soft_block_thresh THEN
      v_blocked := TRUE;
    END IF;
  ELSE
    -- Cashout mode: offered_prob = mark_prob (no entry spread)
    v_final_offered := v_final_mark_prob;
  END IF;

  -- Floor / cap
  IF v_final_offered < 0.01 THEN v_final_offered := 0.01; END IF;
  IF v_final_offered > 0.99 THEN v_final_offered := 0.99; END IF;
  IF v_final_mark_prob < 0.01 THEN v_final_mark_prob := 0.01; END IF;
  IF v_final_mark_prob > 0.99 THEN v_final_mark_prob := 0.99; END IF;

  -- 0036: telemetry write. CRITICAL — wrapped in EXCEPTION WHEN OTHERS so a
  -- failing telemetry insert (table dropped, NOT NULL violation, lock
  -- contention, anything) NEVER blocks the calling RPC. A trade must always
  -- succeed even if telemetry can't be written.
  BEGIN
    INSERT INTO speed_pricing_events (
      asset, duration, side, mode, market_id,
      dist_pct, secs_left, bsm_prob,
      matrix_prob_raw, mark_prob, offered_prob,
      matrix_used, matrix_version, neighbor_used, soft_blocked
    ) VALUES (
      p_asset, p_duration, p_side::speed_side, p_mode, p_market_id,
      p_dist_pct, p_secs_left, p_bsm_prob_side,
      v_matrix_p_raw, v_final_mark_prob, v_final_offered,
      v_used_matrix, v_version, v_neighbor_used, v_blocked
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow telemetry errors. Trade must not fail because telemetry failed.
    NULL;
  END;

  RETURN QUERY SELECT v_final_mark_prob, v_final_offered, v_used_matrix, v_version, v_blocked;
END;
$function$;

COMMENT ON FUNCTION public._speed_pricing_apply(text, speed_duration, text, double precision, double precision, double precision, double precision, text, uuid) IS
  $$0036: shared pricing helper for entry and cashout RPCs. Implements matrix lookup + asymmetric only-push-up rule + soft-block check. Single source of truth — codex hard rule. Volatile (writes to speed_pricing_events for telemetry; insert is wrapped in EXCEPTION WHEN OTHERS so failures cannot block trades).$$;

GRANT EXECUTE ON FUNCTION public._speed_pricing_apply(text, speed_duration, text, double precision, double precision, double precision, double precision, text, uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_pricing_apply(text, speed_duration, text, double precision, double precision, double precision, double precision, text, uuid) TO sooqadmin;

-- 0036: drop the old 8-arg version so we don't have two overloads.
-- The new 9-arg version (with p_market_id DEFAULT NULL) accepts all
-- 8-arg call sites unchanged because the 9th param defaults.
DROP FUNCTION IF EXISTS public._speed_pricing_apply(text, speed_duration, text, double precision, double precision, double precision, double precision, text);
