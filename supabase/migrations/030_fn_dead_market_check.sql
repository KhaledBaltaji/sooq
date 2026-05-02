-- 030_fn_dead_market_check.sql — Auto-void markets with <$100 non-seed after 48hr

CREATE OR REPLACE FUNCTION dead_market_check()
RETURNS INTEGER  -- number of markets voided
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_non_seed_pool DECIMAL;
  v_voided INTEGER := 0;
BEGIN
  -- Auth check: block regular authenticated users; allow service_role and admins only
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'dead_market_check: unauthorized — admin or service_role only';
    END IF;
  END IF;

  FOR v_market IN
    SELECT * FROM markets
    WHERE status = 'open'
      AND created_at < NOW() - INTERVAL '48 hours'
  LOOP
    v_non_seed_pool := (v_market.pool_yes - v_market.seed_amount_yes)
                     + (v_market.pool_no - v_market.seed_amount_no);

    IF v_non_seed_pool < 100 THEN
      -- Delegate to internal helper (handles refunds, commission clawback, status update)
      PERFORM _void_market_internal(v_market.id);
      v_voided := v_voided + 1;
    END IF;
  END LOOP;

  RETURN v_voided;
END;
$$;
