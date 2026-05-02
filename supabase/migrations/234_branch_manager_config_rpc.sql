-- Migration 234: Branch manager config update RPC
-- Branch managers can update their own config (markups, exit fee, display mode, cash out)
-- via SECURITY DEFINER RPC. Cannot touch pool_balance, status, branch_fee_rate, etc.

CREATE OR REPLACE FUNCTION update_branch_config(
  p_branch_id UUID,
  p_yes_markup DECIMAL DEFAULT NULL,
  p_no_markup DECIMAL DEFAULT NULL,
  p_exit_fee DECIMAL DEFAULT NULL,
  p_display_mode TEXT DEFAULT NULL,
  p_cash_out_enabled BOOLEAN DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
BEGIN
  -- Lock and fetch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  -- Auth check: caller must be the branch manager
  IF v_branch.manager_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Validate ranges
  IF p_yes_markup IS NOT NULL AND (p_yes_markup < 0 OR p_yes_markup > 0.50) THEN
    RAISE EXCEPTION 'YES markup must be 0-50%%';
  END IF;
  IF p_no_markup IS NOT NULL AND (p_no_markup < 0 OR p_no_markup > 0.50) THEN
    RAISE EXCEPTION 'NO markup must be 0-50%%';
  END IF;
  IF p_exit_fee IS NOT NULL AND (p_exit_fee < 0 OR p_exit_fee > 0.10) THEN
    RAISE EXCEPTION 'Exit fee must be 0-10%%';
  END IF;
  IF p_display_mode IS NOT NULL AND p_display_mode NOT IN ('betting', 'trading', 'hybrid') THEN
    RAISE EXCEPTION 'Invalid display mode';
  END IF;

  -- Update only allowed columns
  UPDATE branches SET
    yes_markup_pct   = COALESCE(p_yes_markup, yes_markup_pct),
    no_markup_pct    = COALESCE(p_no_markup, no_markup_pct),
    exit_fee_pct     = COALESCE(p_exit_fee, exit_fee_pct),
    display_mode     = COALESCE(p_display_mode, display_mode),
    cash_out_enabled = COALESCE(p_cash_out_enabled, cash_out_enabled),
    updated_at       = NOW()
  WHERE id = p_branch_id;
END;
$$;
