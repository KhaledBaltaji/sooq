-- 115_v3_fn_admin_helpers.sql — lock_market + dead_market_check (V3)

-- ============================================================
-- lock_market: Emergency stop — sets market status to 'closed'
-- ============================================================

CREATE OR REPLACE FUNCTION lock_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
BEGIN
  v_user_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open (status: %)', v_market.status;
  END IF;

  UPDATE markets SET status = 'closed' WHERE id = p_market_id;

  RETURN jsonb_build_object('success', TRUE, 'market_id', p_market_id, 'new_status', 'closed');
END;
$$;


-- ============================================================
-- dead_market_check: Void open markets with <$100 volume after 48h
-- Called by cron job or admin. Service-role or admin only.
-- ============================================================

CREATE OR REPLACE FUNCTION dead_market_check()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_voided INTEGER := 0;
BEGIN
  -- Auth: service_role or admin
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Admin or service_role access required';
    END IF;
  END IF;

  FOR v_market IN
    SELECT m.id
    FROM markets m
    JOIN amm_state a ON a.market_id = m.id
    WHERE m.status = 'open'
      AND m.created_at < NOW() - INTERVAL '48 hours'
      AND a.total_volume < 100
  LOOP
    PERFORM _void_market_internal(v_market.id);
    v_voided := v_voided + 1;
  END LOOP;

  RETURN jsonb_build_object('voided_count', v_voided);
END;
$$;
