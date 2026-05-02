-- Atomic homepage rank update function.
-- Replaces the N+1 loop in rank-markets cron with a single transaction.

CREATE OR REPLACE FUNCTION update_homepage_ranks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Reset all ranks
  UPDATE markets SET homepage_rank = NULL WHERE homepage_rank IS NOT NULL;

  -- Assign ranks atomically using ROW_NUMBER
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY trade_count DESC) AS rn
    FROM markets
    WHERE status = 'open'
  )
  UPDATE markets m
  SET homepage_rank = r.rn
  FROM ranked r
  WHERE m.id = r.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
