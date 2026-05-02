-- Phase 7: Branch webhooks + velocity alerts
-- Adds webhook config columns and check_branch_velocity() function

-- ============================================================
-- Part A: Webhook columns on branches table
-- ============================================================

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

COMMENT ON COLUMN branches.webhook_url IS 'Optional URL for resolution webhook notifications (HMAC-SHA256 signed)';
COMMENT ON COLUMN branches.webhook_secret IS 'HMAC-SHA256 secret for signing webhook payloads';

-- ============================================================
-- Part B: Index for velocity queries on branch_trades
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_branch_trades_branch_created
  ON branch_trades(branch_id, created_at);

-- ============================================================
-- Part C: check_branch_velocity() function
-- Returns branches where today's volume > 5x their 7-day daily average.
-- Skips branches with no history (avoids false alerts on new branches).
-- Dedup: only logs if no velocity alert for this branch in last hour.
-- Called by check-errors cron every 10 min.
-- ============================================================

CREATE OR REPLACE FUNCTION check_branch_velocity()
RETURNS TABLE (
  branch_id UUID,
  branch_name TEXT,
  today_volume DECIMAL,
  daily_average DECIMAL,
  velocity_ratio DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
  v_today_vol DECIMAL;
  v_avg_vol DECIMAL;
  v_ratio DECIMAL;
  v_already_logged BOOLEAN;
BEGIN
  FOR v_branch IN
    SELECT b.id, b.name FROM branches b WHERE b.status NOT IN ('suspended')
  LOOP
    -- Today's gross buy volume
    SELECT COALESCE(SUM(bt.gross_amount), 0) INTO v_today_vol
    FROM branch_trades bt
    WHERE bt.branch_id = v_branch.id
      AND bt.created_at >= date_trunc('day', now());

    -- 7-day daily average (excluding today): total / 7
    SELECT COALESCE(SUM(bt.gross_amount), 0) / 7.0 INTO v_avg_vol
    FROM branch_trades bt
    WHERE bt.branch_id = v_branch.id
      AND bt.created_at >= date_trunc('day', now() - INTERVAL '7 days')
      AND bt.created_at < date_trunc('day', now());

    -- Skip branches with no history (avoid division by zero, avoid flagging new branches)
    IF v_avg_vol <= 0 THEN
      CONTINUE;
    END IF;

    v_ratio := v_today_vol / v_avg_vol;

    IF v_ratio > 5.0 THEN
      -- Dedup: check if we already logged a velocity alert for this branch in the last hour
      SELECT EXISTS(
        SELECT 1 FROM system_logs
        WHERE source = 'pg/branch-velocity'
          AND (context->>'branch_id')::text = v_branch.id::text
          AND created_at >= now() - INTERVAL '1 hour'
      ) INTO v_already_logged;

      IF NOT v_already_logged THEN
        PERFORM log_system_event(
          'warn'::log_severity,
          'pg/branch-velocity',
          'Branch ' || v_branch.name || ' velocity spike: ' || ROUND(v_ratio, 1) || 'x average (today $' || ROUND(v_today_vol, 2) || ' vs avg $' || ROUND(v_avg_vol, 2) || '/day)',
          jsonb_build_object(
            'branch_id', v_branch.id,
            'branch_name', v_branch.name,
            'today_volume', ROUND(v_today_vol, 2),
            'daily_average', ROUND(v_avg_vol, 2),
            'velocity_ratio', ROUND(v_ratio, 2)
          )
        );
      END IF;

      -- Always return the row (even if deduped) so cron can Slack-alert
      branch_id := v_branch.id;
      branch_name := v_branch.name;
      today_volume := ROUND(v_today_vol, 2);
      daily_average := ROUND(v_avg_vol, 2);
      velocity_ratio := ROUND(v_ratio, 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
