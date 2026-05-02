-- ============================================================
-- 218: S2 Branch System — Phase 3.5 Stabilization
--
-- Fixes ALL known gaps from /investigate audit:
-- 1. Credit transfers blocked in payback/frozen (not just suspended)
-- 2. branch_trades: add side + direction columns
-- 3. Retail execute_trade: fix retail_net_cash sell path (gross not net)
-- 4. Payback escalation: add frozen_at, fix double-jump
-- 5. Append-only trigger: use TG_TABLE_NAME for correct error messages
-- 6. branch_trades: add exit_fee_amount column
-- 7. RLS: agents can see sub-agents + assigned users
-- ============================================================

-- ============================================================
-- FIX 5: Generic append-only trigger using TG_TABLE_NAME
-- (Must come FIRST so we can use bypass for Fix 2 backfill)
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_audit_table_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF current_setting('app.trigger_bypass', true) = 'true' THEN
      IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only — updates and deletes are not allowed', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

-- Replace triggers on branch_trades (old function had no bypass)
DROP TRIGGER IF EXISTS trg_branch_trades_no_update ON branch_trades;
DROP TRIGGER IF EXISTS trg_branch_trades_no_delete ON branch_trades;
DROP TRIGGER IF EXISTS prevent_branch_trades_update ON branch_trades;
DROP TRIGGER IF EXISTS prevent_branch_trades_delete ON branch_trades;
CREATE TRIGGER prevent_branch_trades_update BEFORE UPDATE ON branch_trades
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_table_mutation();
CREATE TRIGGER prevent_branch_trades_delete BEFORE DELETE ON branch_trades
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_table_mutation();

-- Replace triggers on branch_admin_overrides
DROP TRIGGER IF EXISTS prevent_branch_admin_overrides_update ON branch_admin_overrides;
DROP TRIGGER IF EXISTS prevent_branch_admin_overrides_delete ON branch_admin_overrides;
CREATE TRIGGER prevent_branch_admin_overrides_update BEFORE UPDATE ON branch_admin_overrides
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_table_mutation();
CREATE TRIGGER prevent_branch_admin_overrides_delete BEFORE DELETE ON branch_admin_overrides
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_table_mutation();

-- ============================================================
-- FIX 4: Add frozen_at to branches
-- ============================================================

ALTER TABLE branches ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;

-- ============================================================
-- FIX 2 + 6: Add side, direction, exit_fee_amount to branch_trades
-- ============================================================

ALTER TABLE branch_trades ADD COLUMN IF NOT EXISTS side bet_side;
ALTER TABLE branch_trades ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('buy', 'sell'));
ALTER TABLE branch_trades ADD COLUMN IF NOT EXISTS exit_fee_amount DECIMAL(18,2) DEFAULT 0;

-- Backfill existing rows using trigger bypass
SELECT set_config('app.trigger_bypass', 'true', false);
UPDATE branch_trades SET side = 'yes', direction = 'buy' WHERE side IS NULL;
SELECT set_config('app.trigger_bypass', '', false);

-- Now make NOT NULL
ALTER TABLE branch_trades ALTER COLUMN side SET NOT NULL;
ALTER TABLE branch_trades ALTER COLUMN direction SET NOT NULL;

-- ============================================================
-- FIX 7: RLS — Agents can see sub-agents + assigned users
-- ============================================================

DROP POLICY IF EXISTS "Agents can read sub-agents" ON branch_agents;
CREATE POLICY "Agents can read sub-agents"
  ON branch_agents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM branch_agents ba
      WHERE ba.user_id = auth.uid()
        AND ba.id = branch_agents.parent_agent_id
        AND ba.branch_id = branch_agents.branch_id
    )
  );

DROP POLICY IF EXISTS "Agents can read assigned users" ON branch_user_assignments;
CREATE POLICY "Agents can read assigned users"
  ON branch_user_assignments FOR SELECT
  USING (
    agent_id IN (SELECT id FROM branch_agents WHERE user_id = auth.uid())
  );

-- ============================================================
-- FIX 1: Recreate branch_credit_transfer — block payback/frozen
-- ============================================================

CREATE OR REPLACE FUNCTION branch_credit_transfer(
  p_branch_id UUID,
  p_recipient_id UUID,
  p_amount DECIMAL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issuer_id UUID;
  v_branch RECORD;
  v_issuer RECORD;
  v_recipient RECORD;
  v_issuer_role credit_chain_role;
  v_recipient_role credit_chain_role;
  v_issuer_rank INT;
  v_recipient_rank INT;
  v_issuer_agent RECORD;
  v_recipient_agent RECORD;
  v_issuer_new_balance DECIMAL;
  v_recipient_new_balance DECIMAL;
  v_credit_id UUID;
BEGIN
  v_issuer_id := auth.uid();
  IF v_issuer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum ($100,000)';
  END IF;

  -- Lock branch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- *** FIX: Block credits in payback, frozen, AND suspended ***
  IF v_branch.status IN ('payback', 'frozen', 'suspended') THEN
    RAISE EXCEPTION 'Branch is in % mode — credit transfers blocked', v_branch.status;
  END IF;

  -- Lock both user rows (consistent order by UUID)
  IF v_issuer_id < p_recipient_id THEN
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
  END IF;

  IF v_issuer IS NULL THEN RAISE EXCEPTION 'Issuer not found'; END IF;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF v_issuer.is_frozen THEN RAISE EXCEPTION 'Your account is frozen'; END IF;
  IF v_recipient.is_frozen THEN RAISE EXCEPTION 'Recipient account is frozen'; END IF;

  -- ═══ DETERMINE ISSUER ROLE ═══
  IF v_issuer.is_admin THEN
    v_issuer_role := 'admin';
    v_issuer_rank := 0;
  ELSIF v_branch.manager_user_id = v_issuer_id THEN
    v_issuer_role := 'branch_manager';
    v_issuer_rank := 1;
  ELSE
    SELECT * INTO v_issuer_agent
    FROM branch_agents
    WHERE user_id = v_issuer_id AND branch_id = p_branch_id AND is_active = true;

    IF FOUND THEN
      IF v_issuer_agent.parent_agent_id IS NULL THEN
        v_issuer_role := 'agent';
        v_issuer_rank := 2;
      ELSE
        v_issuer_role := 'sub_agent';
        v_issuer_rank := 3;
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to issue credits in this branch';
    END IF;
  END IF;

  -- ═══ DETERMINE RECIPIENT ROLE ═══
  IF v_recipient.is_admin THEN
    v_recipient_role := 'admin';
    v_recipient_rank := 0;
  ELSIF v_branch.manager_user_id = p_recipient_id THEN
    v_recipient_role := 'branch_manager';
    v_recipient_rank := 1;
  ELSE
    SELECT * INTO v_recipient_agent
    FROM branch_agents
    WHERE user_id = p_recipient_id AND branch_id = p_branch_id;

    IF FOUND THEN
      IF v_recipient_agent.parent_agent_id IS NULL THEN
        v_recipient_role := 'agent';
        v_recipient_rank := 2;
      ELSE
        v_recipient_role := 'sub_agent';
        v_recipient_rank := 3;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM branch_user_assignments WHERE user_id = p_recipient_id AND branch_id = p_branch_id) THEN
        v_recipient_role := 'user';
        v_recipient_rank := 4;
      ELSE
        RAISE EXCEPTION 'Recipient not assigned to this branch';
      END IF;
    END IF;
  END IF;

  -- ═══ HIERARCHY VALIDATION (downward only) ═══
  IF v_issuer_rank >= v_recipient_rank THEN
    RAISE EXCEPTION 'Credits can only flow downward (% cannot credit %)',
      v_issuer_role, v_recipient_role;
  END IF;

  -- Agent → sub_agent: verify parent chain
  IF v_issuer_role = 'agent' AND v_recipient_role = 'sub_agent' THEN
    IF v_recipient_agent.parent_agent_id != v_issuer_agent.id THEN
      RAISE EXCEPTION 'Sub-agent does not belong to your agent network';
    END IF;
  END IF;

  -- Sub-agent → user: verify assignment
  IF v_issuer_role = 'sub_agent' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments
      WHERE user_id = p_recipient_id AND branch_id = p_branch_id
        AND agent_id = v_issuer_agent.id
    ) THEN
      RAISE EXCEPTION 'User is not assigned to your agent network';
    END IF;
  END IF;

  -- Agent → user: verify assignment (direct or via sub-agents)
  IF v_issuer_role = 'agent' AND v_recipient_role = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments bua
      WHERE bua.user_id = p_recipient_id AND bua.branch_id = p_branch_id
        AND (bua.agent_id = v_issuer_agent.id
          OR bua.agent_id IN (SELECT id FROM branch_agents WHERE parent_agent_id = v_issuer_agent.id))
    ) THEN
      RAISE EXCEPTION 'User is not in your agent network';
    END IF;
  END IF;

  -- ═══ BALANCE CHECK ═══
  IF v_issuer.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance ($% available)', ROUND(v_issuer.balance_usd, 2);
  END IF;

  -- ═══ EXECUTE TRANSFER ═══
  UPDATE users SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE id = v_issuer_id
  RETURNING balance_usd INTO v_issuer_new_balance;

  UPDATE users SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_recipient_id
  RETURNING balance_usd INTO v_recipient_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (v_issuer_id, 'branch_credit_out', -p_amount, v_issuer_new_balance,
          COALESCE(p_description, 'Branch credit to ' || p_recipient_id::TEXT), v_issuer_id);

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_recipient_id, 'branch_credit_in', p_amount, v_recipient_new_balance,
          COALESCE(p_description, 'Branch credit from ' || v_issuer_id::TEXT), v_issuer_id);

  INSERT INTO credit_chain_ledger (branch_id, issuer_id, recipient_id, issuer_role, recipient_role, amount, description)
  VALUES (p_branch_id, v_issuer_id, p_recipient_id, v_issuer_role, v_recipient_role, p_amount, p_description)
  RETURNING id INTO v_credit_id;

  PERFORM log_system_event('info'::log_severity, 'branch/credit_transfer',
    'Credit transfer: ' || v_issuer_role || ' → ' || v_recipient_role || ' $' || p_amount,
    jsonb_build_object(
      'credit_id', v_credit_id, 'branch_id', p_branch_id,
      'issuer_id', v_issuer_id, 'recipient_id', p_recipient_id,
      'issuer_role', v_issuer_role, 'recipient_role', v_recipient_role,
      'amount', p_amount
    )
  );

  RETURN jsonb_build_object(
    'credit_id', v_credit_id,
    'issuer_new_balance', ROUND(v_issuer_new_balance, 2),
    'recipient_new_balance', ROUND(v_recipient_new_balance, 2),
    'issuer_role', v_issuer_role,
    'recipient_role', v_recipient_role
  );
END;
$$;

-- ============================================================
-- FIX 4: Recreate check_payback_escalation — use frozen_at
-- ============================================================

CREATE OR REPLACE FUNCTION check_payback_escalation()
RETURNS TABLE (branch_id UUID, old_status TEXT, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Escalate frozen → suspended: use frozen_at (NOT payback_activated_at)
  FOR v_branch IN
    SELECT * FROM branches
    WHERE status = 'frozen'
      AND frozen_at IS NOT NULL
      AND frozen_at + INTERVAL '30 days' < now()
  LOOP
    UPDATE branches SET
      status = 'suspended',
      suspension_reason = 'Payback escalation: 30+ days frozen',
      updated_at = NOW()
    WHERE id = v_branch.id;

    PERFORM log_system_event('error'::log_severity, 'branch/payback_escalation',
      'Branch ' || v_branch.name || ' escalated: frozen → suspended',
      jsonb_build_object('branch_id', v_branch.id, 'frozen_days', 30)
    );

    branch_id := v_branch.id;
    old_status := 'frozen';
    new_status := 'suspended';
    RETURN NEXT;
  END LOOP;

  -- Escalate payback → frozen: use payback_activated_at, SET frozen_at
  FOR v_branch IN
    SELECT * FROM branches
    WHERE status = 'payback'
      AND payback_activated_at IS NOT NULL
      AND payback_activated_at + INTERVAL '14 days' < now()
  LOOP
    UPDATE branches SET
      status = 'frozen',
      frozen_at = NOW(),
      suspension_reason = 'Payback escalation: 14+ days unresolved',
      updated_at = NOW()
    WHERE id = v_branch.id;

    PERFORM log_system_event('warn'::log_severity, 'branch/payback_escalation',
      'Branch ' || v_branch.name || ' escalated: payback → frozen',
      jsonb_build_object('branch_id', v_branch.id, 'days', 14)
    );

    branch_id := v_branch.id;
    old_status := 'payback';
    new_status := 'frozen';
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============================================================
-- FIX 4: Recreate clear_payback_mode — also clear frozen_at
-- ============================================================

CREATE OR REPLACE FUNCTION clear_payback_mode(p_branch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_branch.status != 'payback' THEN RETURN; END IF;
  IF v_branch.pending_payouts > 0 THEN RETURN; END IF;

  UPDATE branches SET
    status = 'active',
    payback_activated_at = NULL,
    payback_reason = NULL,
    pending_payouts = 0,
    frozen_at = NULL,
    updated_at = NOW()
  WHERE id = p_branch_id;

  PERFORM log_system_event('info'::log_severity, 'branch/payback_cleared',
    'Branch ' || v_branch.name || ' payback cleared — returned to active',
    jsonb_build_object('branch_id', p_branch_id)
  );
END;
$$;

-- ============================================================
-- FIX 4: Recreate admin_update_branch_status — set/clear frozen_at
-- ============================================================

CREATE OR REPLACE FUNCTION admin_update_branch_status(
  p_branch_id UUID,
  p_new_status TEXT,
  p_reason TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_old_status TEXT;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  v_old_status := v_branch.status::TEXT;

  IF v_old_status = p_new_status THEN
    RAISE EXCEPTION 'Branch is already in % status', p_new_status;
  END IF;

  IF p_new_status NOT IN ('active', 'payback', 'frozen', 'suspended') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  -- If clearing payback, check pending_payouts
  IF v_old_status = 'payback' AND p_new_status = 'active' THEN
    IF v_branch.pending_payouts > 0 THEN
      IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Reason required when clearing payback with pending payouts ($%)',
          ROUND(v_branch.pending_payouts, 2);
      END IF;
      UPDATE branches SET pending_payouts = 0 WHERE id = p_branch_id;
    END IF;
  END IF;

  -- Execute status change
  UPDATE branches SET
    status = p_new_status::branch_status,
    suspension_reason = CASE WHEN p_new_status IN ('frozen', 'suspended') THEN p_reason ELSE NULL END,
    payback_activated_at = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_activated_at, now())
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_activated_at
    END,
    payback_reason = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_reason, p_reason)
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_reason
    END,
    -- *** FIX: set/clear frozen_at ***
    frozen_at = CASE
      WHEN p_new_status = 'frozen' THEN COALESCE(v_branch.frozen_at, NOW())
      WHEN p_new_status IN ('active', 'payback') THEN NULL
      ELSE v_branch.frozen_at
    END,
    updated_at = NOW()
  WHERE id = p_branch_id;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'status_change', COALESCE(p_reason, 'Admin status change'),
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/status_change',
    'Branch status: ' || v_old_status || ' → ' || p_new_status,
    jsonb_build_object(
      'branch_id', p_branch_id, 'admin_id', v_admin_id,
      'old_status', v_old_status, 'new_status', p_new_status, 'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'reason', p_reason
  );
END;
$$;

-- ============================================================
-- FIX 2: Recreate execute_branch_trade — populate side/direction/exit_fee_amount
-- (Also includes the payback sweep fix from earlier + _try_clear_payback)
-- ============================================================

CREATE OR REPLACE FUNCTION execute_branch_trade(
  p_market_id UUID,
  p_branch_id UUID,
  p_side TEXT,
  p_amount DECIMAL DEFAULT NULL,
  p_shares_to_sell DECIMAL DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_branch RECORD;
  v_position RECORD;
  v_assignment RECORD;
  v_market_config RECORD;

  v_price_impact_cap DECIMAL;
  v_min_trade DECIMAL;

  v_markup_pct DECIMAL;
  v_markup_amount DECIMAL;
  v_net_canonical DECIMAL;

  v_b DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_price_per_share DECIMAL;
  v_price_impact DECIMAL;

  v_gross_proceeds DECIMAL;
  v_exit_fee DECIMAL;
  v_net_proceeds DECIMAL;
  v_sell_pnl DECIMAL;
  v_cash_out_enabled BOOLEAN;

  v_solvency JSONB;
  v_old_worst_case DECIMAL;
  v_new_worst_case DECIMAL;
  v_worst_case_delta DECIMAL;

  v_position_cap DECIMAL;
  v_current_shares DECIMAL := 0;

  v_trade_id UUID;
  v_branch_trade_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT bt.id INTO v_branch_trade_id
    FROM branch_trades bt
    WHERE bt.branch_id = p_branch_id AND bt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'trade_id', v_branch_trade_id,
        'idempotent', true,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  -- Lock order: user → market → amm_state → branches
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.status IN ('frozen', 'suspended') THEN
    RAISE EXCEPTION 'Branch is %', v_branch.status;
  END IF;

  SELECT * INTO v_assignment
  FROM branch_user_assignments
  WHERE user_id = v_user_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  SELECT * INTO v_market_config
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  IF FOUND AND NOT v_market_config.is_enabled THEN
    RAISE EXCEPTION 'Market is disabled for this branch';
  END IF;

  SELECT rate INTO v_price_impact_cap FROM fee_config
  WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;

  SELECT rate INTO v_min_trade FROM fee_config
  WHERE fee_type = 'min_trade_amount' AND level IS NULL;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══

    IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
      RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
    END IF;

    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_markup_pct := CASE WHEN p_side = 'yes' THEN v_branch.yes_markup_pct
                         ELSE v_branch.no_markup_pct END;
    v_markup_amount := ROUND(p_amount * v_markup_pct, 2);
    v_net_canonical := p_amount - v_markup_amount;

    IF v_net_canonical <= 0 THEN
      RAISE EXCEPTION 'Trade too small after markup';
    END IF;

    v_position_cap := CASE WHEN p_side = 'yes' THEN
      COALESCE(v_market_config.position_cap_yes, v_branch.default_position_cap_yes)
    ELSE
      COALESCE(v_market_config.position_cap_no, v_branch.default_position_cap_no)
    END;

    IF v_position_cap IS NOT NULL THEN
      SELECT COALESCE(shares_held, 0) INTO v_current_shares
      FROM positions
      WHERE user_id = v_user_id AND market_id = p_market_id
        AND side = p_side::bet_side AND branch_id = p_branch_id;
    END IF;

    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_canonical);
    IF v_shares <= 0 THEN RAISE EXCEPTION 'Trade too small'; END IF;

    IF v_position_cap IS NOT NULL AND (v_current_shares + v_shares) * 0.99 > v_position_cap THEN
      RAISE EXCEPTION 'Position cap exceeded (max $%)', v_position_cap;
    END IF;

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);
    DECLARE
      v_est_yes DECIMAL; v_est_no DECIMAL; v_est_cash DECIMAL; v_est_w DECIMAL;
    BEGIN
      SELECT COALESCE(SUM(shares_held), 0) INTO v_est_yes
      FROM positions WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;
      SELECT COALESCE(SUM(shares_held), 0) INTO v_est_no
      FROM positions WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

      IF p_side = 'yes' THEN v_est_yes := v_est_yes + v_shares;
      ELSE v_est_no := v_est_no + v_shares; END IF;

      SELECT COALESCE(SUM(CASE WHEN type IN ('trade_buy','exit_fee') THEN amount
                               WHEN type = 'trade_sell' THEN amount ELSE 0 END), 0) INTO v_est_cash
      FROM branch_pools WHERE branch_id = p_branch_id AND market_id = p_market_id;
      v_est_cash := v_est_cash + p_amount;

      v_est_w := GREATEST(0, GREATEST(v_est_yes * 0.99, v_est_no * 0.99) - v_est_cash);
      v_worst_case_delta := v_est_w - v_old_worst_case;
    END;

    v_solvency := branch_solvency_check(p_branch_id, p_amount, v_worst_case_delta);
    IF NOT (v_solvency->>'can_trade')::BOOLEAN THEN
      RAISE EXCEPTION 'Branch solvency gate: trade rejected (utilization %)', v_solvency->>'utilization';
    END IF;

    IF v_branch.status = 'payback' THEN
      DECLARE v_pp DECIMAL; v_ar DECIMAL;
      BEGIN
        v_pp := v_branch.pool_balance + p_amount;
        v_ar := v_pp - v_branch.pending_payouts;
        IF v_ar < (v_branch.worst_case_total + v_worst_case_delta) THEN
          RAISE EXCEPTION 'Payback mode: insufficient post-trade coverage';
        END IF;
      END;
    END IF;

    v_price_per_share := v_net_canonical / v_shares;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_net_canonical, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, p_branch_id, v_shares, v_price_per_share, v_net_canonical)
    ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_canonical) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_canonical;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, 0, v_markup_amount, 0,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

    -- *** FIX: populate side, direction, exit_fee_amount ***
    INSERT INTO branch_trades (
      trade_id, branch_id, agent_id, user_id, market_id,
      gross_amount, branch_markup, net_canonical_amount, branch_quote_shown,
      canonical_pre_yes_price, canonical_pre_no_price,
      canonical_post_yes_price, canonical_post_no_price,
      shares_issued, idempotency_key,
      side, direction, exit_fee_amount
    ) VALUES (
      v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
      p_amount, v_markup_amount, v_net_canonical, v_price_per_share,
      v_amm.current_yes_price, v_amm.current_no_price,
      v_new_yes_price, v_new_no_price,
      v_shares, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
      p_side::bet_side, 'buy', 0
    );

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_buy', p_amount,
            v_branch.pool_balance + p_amount, v_trade_id,
            'Buy ' || p_side || ' — gross $' || p_amount);

    UPDATE branches SET
      pool_balance = pool_balance + p_amount,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    -- Payback sweep on buy inflow
    IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 THEN
      DECLARE v_sweep DECIMAL;
      BEGIN
        v_sweep := LEAST(p_amount, v_branch.pending_payouts);
        IF v_sweep > 0 THEN
          INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
          VALUES (p_branch_id, 'payback_sweep', -v_sweep,
                  v_branch.pool_balance + p_amount - v_sweep, 'Payback sweep on buy inflow');
          UPDATE branches SET
            pending_payouts = GREATEST(0, pending_payouts - v_sweep),
            pool_balance = pool_balance - v_sweep
          WHERE id = p_branch_id;
        END IF;
      END;
      PERFORM _try_clear_payback(p_branch_id);
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id,
            'Branch buy ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'trade_id', v_trade_id,
      'shares', ROUND(v_shares, 6),
      'price_per_share', ROUND(v_price_per_share, 6),
      'total_cost', ROUND(p_amount, 2),
      'markup', ROUND(v_markup_amount, 2),
      'net_canonical', ROUND(v_net_canonical, 2),
      'new_yes_price', ROUND(v_new_yes_price, 6),
      'new_no_price', ROUND(v_new_no_price, 6),
      'price_impact', ROUND(v_price_impact, 6),
      'solvency_status', v_solvency->>'status'
    );

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH ═══

    v_cash_out_enabled := COALESCE(v_market_config.cash_out_enabled, v_branch.cash_out_enabled);
    IF NOT v_cash_out_enabled THEN
      RAISE EXCEPTION 'Cash-out is disabled for this market';
    END IF;

    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id
      AND side = p_side::bet_side AND branch_id = p_branch_id
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    IF v_branch.pool_balance < v_gross_proceeds THEN
      RAISE EXCEPTION 'Branch pool insufficient for cash-out';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_exit_fee := ROUND(v_gross_proceeds * v_branch.exit_fee_pct, 2);
    v_net_proceeds := v_gross_proceeds - v_exit_fee;
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    UPDATE positions SET shares_held = 0, total_invested = 0
    WHERE id = v_position.id AND shares_held > 0 AND shares_held < 0.001;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, 0, 0, v_exit_fee,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

    -- *** FIX: populate side, direction, exit_fee_amount; branch_markup = 0 on sells ***
    INSERT INTO branch_trades (
      trade_id, branch_id, agent_id, user_id, market_id,
      gross_amount, branch_markup, net_canonical_amount, branch_quote_shown,
      canonical_pre_yes_price, canonical_pre_no_price,
      canonical_post_yes_price, canonical_post_no_price,
      shares_issued, idempotency_key,
      side, direction, exit_fee_amount
    ) VALUES (
      v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
      v_gross_proceeds, 0, v_gross_proceeds - v_exit_fee, v_price_per_share,
      v_amm.current_yes_price, v_amm.current_no_price,
      v_new_yes_price, v_new_no_price,
      v_shares_to_sell, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
      p_side::bet_side, 'sell', v_exit_fee
    );

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_sell', -v_gross_proceeds,
            v_branch.pool_balance - v_gross_proceeds, v_trade_id,
            'Sell ' || p_side || ' — payout $' || v_gross_proceeds);

    IF v_exit_fee > 0 THEN
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (p_branch_id, p_market_id, 'exit_fee', v_exit_fee,
              v_branch.pool_balance - v_gross_proceeds + v_exit_fee, v_trade_id,
              'Exit fee retained $' || v_exit_fee);
    END IF;

    v_new_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);
    v_worst_case_delta := v_new_worst_case - v_old_worst_case;

    UPDATE branches SET
      pool_balance = pool_balance - v_gross_proceeds + v_exit_fee,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    -- Payback sweep on exit fee inflow
    IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 AND v_exit_fee > 0 THEN
      DECLARE v_sweep DECIMAL;
      BEGIN
        v_sweep := LEAST(v_exit_fee, v_branch.pending_payouts);
        IF v_sweep > 0 THEN
          INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
          VALUES (p_branch_id, 'payback_sweep', -v_sweep,
                  v_branch.pool_balance - v_gross_proceeds + v_exit_fee - v_sweep,
                  'Payback sweep on exit fee');
          UPDATE branches SET
            pending_payouts = GREATEST(0, pending_payouts - v_sweep),
            pool_balance = pool_balance - v_sweep
          WHERE id = p_branch_id;
        END IF;
      END;
      PERFORM _try_clear_payback(p_branch_id);
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_user.balance_usd + v_net_proceeds, v_trade_id,
            'Branch sell ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'trade_id', v_trade_id,
      'shares', ROUND(v_shares_to_sell, 6),
      'price_per_share', ROUND(v_price_per_share, 6),
      'gross_proceeds', ROUND(v_gross_proceeds, 2),
      'exit_fee', ROUND(v_exit_fee, 2),
      'net_proceeds', ROUND(v_net_proceeds, 2),
      'new_yes_price', ROUND(v_new_yes_price, 6),
      'new_no_price', ROUND(v_new_no_price, 6),
      'price_impact', ROUND(v_price_impact, 6)
    );

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;
END;
$$;

-- ============================================================
-- FIX 3: Recreate retail execute_trade — fix retail_net_cash on sell
-- Only the sell path amm_state UPDATE changes:
--   retail_net_cash = retail_net_cash - v_gross_proceeds (was v_net_proceeds)
-- ============================================================

-- Read the full current execute_trade and only change line 284
-- We need to CREATE OR REPLACE the entire function

-- NOTE: This recreation is done by reading the current 213 version
-- and changing only the retail_net_cash line in the sell path.
-- For brevity and safety, we use a targeted approach:

DO $$
DECLARE
  v_src TEXT;
BEGIN
  -- Get current function source
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'execute_trade'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

  -- Replace the specific string in sell path
  -- Old: retail_net_cash = retail_net_cash - v_net_proceeds,
  -- New: retail_net_cash = retail_net_cash - v_gross_proceeds,
  v_src := replace(v_src,
    'retail_net_cash = retail_net_cash - v_net_proceeds,',
    'retail_net_cash = retail_net_cash - v_gross_proceeds,');

  -- Recreate function with fixed source (must match original 4-param signature exactly)
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION execute_trade(
      p_market_id UUID,
      p_side TEXT,
      p_amount DECIMAL DEFAULT NULL,
      p_shares_to_sell DECIMAL DEFAULT NULL
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, extensions
    AS $fn$%s$fn$', v_src);
END;
$$;
