-- ============================================================================
-- _speed_promote_matrix_version — manual promotion of shadow → active
-- ============================================================================
--
-- Mig 0037: admin runs this after reviewing shadow-vs-active diff for ≥7
-- nightly cycles (per the dual-run safety gate in the cleanup plan).
--
-- Guard: refuses to promote a 'rejected' version (property tests failed).
-- Atomic: marks all previously active versions as superseded in the same
-- transaction, then sets target version to active and updates fee_config
-- so _speed_matrix_lookup picks up the new version on the next pricing call.

CREATE OR REPLACE FUNCTION public._speed_promote_matrix_version(
  p_version_id integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_version    record;
  v_old_active integer;
BEGIN
  SELECT id, asset, duration, status, n_markets, n_obs_total, computed_at
    INTO v_version
    FROM speed_pricing_matrix_versions
   WHERE id = p_version_id;

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'no matrix version with id=%', p_version_id;
  END IF;

  IF v_version.status = 'rejected' THEN
    RAISE EXCEPTION 'cannot promote rejected version % (property tests failed during recalibration)', p_version_id;
  END IF;

  IF v_version.status = 'active' THEN
    RAISE NOTICE 'version % is already active; no-op', p_version_id;
    RETURN jsonb_build_object('promoted', false, 'reason', 'already_active', 'version_id', p_version_id);
  END IF;

  -- Find current active version for the same (asset, duration) pair
  SELECT id INTO v_old_active
    FROM speed_pricing_matrix_versions
   WHERE asset = v_version.asset AND duration = v_version.duration AND status = 'active'
   ORDER BY computed_at DESC LIMIT 1;

  -- Mark old active as superseded
  IF v_old_active IS NOT NULL THEN
    UPDATE speed_pricing_matrix_versions
       SET status = 'superseded'
     WHERE id = v_old_active;
  END IF;

  -- Promote target
  UPDATE speed_pricing_matrix_versions
     SET status = 'active'
   WHERE id = p_version_id;

  -- Sync fee_config so _speed_matrix_lookup picks up the new version
  INSERT INTO fee_config (fee_type, rate, description, updated_at)
  VALUES ('speed_pricing_matrix_version', p_version_id,
          '0034: active pricing matrix version (auto-set by recalibration cron / promotion)', NOW())
  ON CONFLICT (fee_type) DO UPDATE SET rate = p_version_id, updated_at = NOW();

  RETURN jsonb_build_object(
    'promoted', true,
    'version_id', p_version_id,
    'asset', v_version.asset,
    'duration', v_version.duration,
    'previous_active', v_old_active,
    'n_markets', v_version.n_markets,
    'n_obs_total', v_version.n_obs_total
  );
END;
$$;

COMMENT ON FUNCTION public._speed_promote_matrix_version(integer) IS
  '0037: manual promotion of a shadow matrix version to active. Admin invokes after reviewing dual-run diff for ≥7 nightly cycles. Refuses to promote rejected versions (property tests failed during recalibration). Atomically supersedes the previous active version and updates fee_config so _speed_matrix_lookup picks up the change on the next pricing call.';

GRANT EXECUTE ON FUNCTION public._speed_promote_matrix_version(integer) TO PUBLIC;
