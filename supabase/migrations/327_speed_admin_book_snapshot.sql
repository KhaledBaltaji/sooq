-- ============================================================================
-- 327_speed_admin_book_snapshot.sql
--
-- PIN-gated admin RPC to record a daily Binance Futures snapshot for the
-- ops dashboard's reconciliation panel.
--
-- Inputs match the inline form on /admin/speed/operations:
-- asset, position size, mark price, unrealized P&L, realized since last,
-- funding paid, margin balance, optional notes.
--
-- These are SOOQ's internal accounting only — branches never see them.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_record_book_snapshot(
  p_asset                    speed_asset,
  p_snapshot_at              TIMESTAMPTZ,
  p_net_position_qty         DECIMAL,
  p_avg_entry_price          DECIMAL,
  p_mark_price               DECIMAL,
  p_unrealized_pnl_usd       DECIMAL,
  p_realized_pnl_since_last  DECIMAL,
  p_funding_paid_since_last  DECIMAL,
  p_margin_balance_usd       DECIMAL,
  p_notes                    TEXT,
  p_pin                      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id     UUID;
  v_snapshot_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  INSERT INTO speed_external_book_snapshots (
    asset, venue, snapshot_at,
    net_position_qty, avg_entry_price, mark_price,
    unrealized_pnl_usd, realized_pnl_since_last, funding_paid_since_last,
    margin_balance_usd, recorded_by, notes
  ) VALUES (
    p_asset, 'binance_futures', p_snapshot_at,
    p_net_position_qty, p_avg_entry_price, p_mark_price,
    p_unrealized_pnl_usd, p_realized_pnl_since_last, p_funding_paid_since_last,
    p_margin_balance_usd, v_admin_id, p_notes
  )
  RETURNING id INTO v_snapshot_id;

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Book snapshot recorded: ' || p_asset::TEXT || ' qty=' || p_net_position_qty,
    jsonb_build_object(
      'event', 'book_snapshot',
      'admin_id', v_admin_id, 'snapshot_id', v_snapshot_id, 'asset', p_asset,
      'unrealized_pnl', p_unrealized_pnl_usd, 'realized_pnl', p_realized_pnl_since_last
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'snapshot_id', v_snapshot_id,
    'asset', p_asset
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_record_book_snapshot(speed_asset, TIMESTAMPTZ, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT) IS
'PIN-gated admin RPC. Records daily Binance Futures snapshot for ops dashboard reconciliation.';
