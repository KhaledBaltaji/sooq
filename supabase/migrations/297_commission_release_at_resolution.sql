-- ============================================================
-- 297: Commission Branch Phase B part 2 — release-at-resolution
--
-- Changes commission release semantics from a 30-day monthly calendar lock
-- (mig 250) to release-when-the-market-resolves. Applies to ALL agents —
-- retail /r/[code] agents, commission-branch owners, sub-agents. Same rule
-- everywhere.
--
-- State machine (unchanged statuses, one new one):
--
--     INSERT (trade-time, agent not activated)  → 'escrowed'
--     INSERT (trade-time, agent activated, market open/locked)  → 'pending'  [NEW]
--     INSERT (resolution-time, agent activated)  → 'credited'
--     INSERT (resolution-time, agent not activated)  → 'escrowed' (released at activation)
--
--     market.status = open/locked → resolved  → pending rows flip to 'credited' (balance credited now)
--     market.status = open/locked → voided    → pending rows flip to 'voided' (no balance change)
--     agent becomes activated  → escrowed rows processed based on market state:
--                                 resolved → credited + balance
--                                 open/locked → pending (no balance)
--                                 voided → voided (no balance)
--
-- IMPLEMENTATION approach: use an AFTER UPDATE trigger on markets.status
-- instead of editing resolve_market / _void_market_internal directly. Much
-- smaller diff, fires regardless of HOW the status change happens.
--
-- Backfill: release currently-locked commissions (unlock_at IS NOT NULL)
-- immediately. Don't flip any statuses backwards — we accept the trade-off
-- of a one-time "unlock cliff" for existing users, and new commissions follow
-- the strict release-at-resolution model.
--
-- Depends on: mig 296 (adds 'pending' to commission_status enum).
-- ============================================================

BEGIN;

-- ============================================================
-- §1. _credit_commission — redefined with release-at-resolution semantics
--
-- Called from pay_trade_commissions (trade-time) and settle_resolution_commissions
-- (resolution-time). Discriminates on p_revenue_type and on the market's
-- current status to pick the right initial status.
-- ============================================================

CREATE OR REPLACE FUNCTION _credit_commission(
  p_ancestor_id UUID,
  p_trader_id UUID,
  p_market_id UUID,
  p_trade_id UUID,
  p_layer INTEGER,
  p_agent_level INTEGER,
  p_platform_revenue NUMERIC,
  p_fee_type TEXT,
  p_revenue_type TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_new_balance DECIMAL;
  v_activated BOOLEAN;
  v_market_status TEXT;
  v_status commission_status;
  v_should_credit BOOLEAN;
BEGIN
  -- Lookup the commission rate for this tier + layer + fee type
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = p_fee_type
    AND level = p_agent_level
    AND depth = p_layer;

  IF v_rate IS NULL OR v_rate = 0 THEN
    RETURN 0;
  END IF;

  v_commission := p_platform_revenue * v_rate;

  -- Dust threshold: don't create sub-cent rows
  IF v_commission < 0.01 THEN
    RETURN 0;
  END IF;

  v_activated := _is_agent_activated(p_ancestor_id);

  -- Decide status:
  --  - Not activated → 'escrowed' (unchanged, released via _release_escrowed_commissions on activation)
  --  - Activated + resolution-time → 'credited' (the market is resolving RIGHT NOW)
  --  - Activated + trade-time → depends on market.status:
  --      open/locked → 'pending' (wait for resolution)
  --      resolved   → 'credited' (rare: trade happened but resolution landed first)
  --      voided     → 'voided' (shouldn't happen since market rejects trades)
  IF NOT v_activated THEN
    v_status := 'escrowed';
    v_should_credit := FALSE;
  ELSIF p_revenue_type = 'resolution' THEN
    v_status := 'credited';
    v_should_credit := TRUE;
  ELSE
    -- Trade-time, activated agent — check market status
    SELECT status INTO v_market_status FROM markets WHERE id = p_market_id;
    IF v_market_status IN ('open', 'closed') THEN
      v_status := 'pending';
      v_should_credit := FALSE;
    ELSIF v_market_status = 'resolved' THEN
      v_status := 'credited';
      v_should_credit := TRUE;
    ELSIF v_market_status = 'voided' THEN
      v_status := 'voided';
      v_should_credit := FALSE;
    ELSE
      -- Unknown state → default to pending (safest: not in balance yet)
      v_status := 'pending';
      v_should_credit := FALSE;
    END IF;
  END IF;

  -- Insert the commission row. unlock_at is always NULL going forward
  -- (the status column is the authoritative release gate).
  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type, unlock_at
  ) VALUES (
    p_ancestor_id, p_trader_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission,
    v_status,
    p_revenue_type,
    NULL
  );

  -- Only credit the wallet when the commission is immediately spendable
  IF v_should_credit THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
    WHERE id = p_ancestor_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      p_ancestor_id, 'commission', v_commission,
      v_new_balance,
      COALESCE(p_trade_id, p_market_id),
      'Commission (Layer ' || p_layer || ', ' || p_revenue_type || ') — '
      || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 2) || ' platform revenue'
    );
  END IF;

  RETURN v_commission;
END;
$$;

-- ============================================================
-- §2. _release_pending_commissions_for_market — helper to sweep pending → credited
--
-- Called by the market-status trigger (§4) when a market transitions
-- open/closed → resolved. Crediting is done per-row so we get individual
-- transaction ledger entries (important for audit).
-- ============================================================

CREATE OR REPLACE FUNCTION _release_pending_commissions_for_market(p_market_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_comm RECORD;
  v_new_balance DECIMAL;
  v_count INTEGER := 0;
BEGIN
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'pending'
  LOOP
    -- Flip to credited + increment wallet + write ledger
    UPDATE referral_commissions SET status = 'credited'
    WHERE id = v_comm.id;

    UPDATE users SET agent_balance_usd = agent_balance_usd + v_comm.commission_amount
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', v_comm.commission_amount,
      v_new_balance,
      COALESCE(v_comm.trade_id, v_comm.market_id),
      'Commission released at resolution (Layer ' || v_comm.layer || ', '
      || v_comm.revenue_type || ') — $' || ROUND(v_comm.commission_amount, 2)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- §3. _release_escrowed_commissions — respect market status on activation release
--
-- When an agent becomes activated (5 qualified referrals), their escrowed
-- commissions release. Previously this flipped ALL escrowed → credited.
-- Now it respects market status:
--   - Resolved market → credited + balance
--   - Open/closed market → pending (wait for resolution)
--   - Voided market → voided (never earned)
--
-- Returns the total dollar amount credited to the wallet (pending rows
-- don't count — they stay off balance until their market resolves).
-- ============================================================

CREATE OR REPLACE FUNCTION _release_escrowed_commissions(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_comm RECORD;
  v_market_status TEXT;
  v_total_credited DECIMAL := 0;
  v_new_balance DECIMAL;
BEGIN
  FOR v_comm IN
    SELECT c.* FROM referral_commissions c
    WHERE c.referrer_id = p_user_id AND c.status = 'escrowed'
    ORDER BY c.id
  LOOP
    SELECT status INTO v_market_status FROM markets WHERE id = v_comm.market_id;

    IF v_market_status = 'resolved' THEN
      -- Market already resolved → credit immediately
      UPDATE referral_commissions SET status = 'credited' WHERE id = v_comm.id;
      v_total_credited := v_total_credited + v_comm.commission_amount;
    ELSIF v_market_status IN ('open', 'closed') THEN
      -- Market still open → defer to pending
      UPDATE referral_commissions SET status = 'pending' WHERE id = v_comm.id;
    ELSIF v_market_status = 'voided' THEN
      -- Market already voided → this commission was never valid
      UPDATE referral_commissions SET status = 'voided' WHERE id = v_comm.id;
    ELSE
      -- Unknown market state → leave as escrowed (manual admin review)
      CONTINUE;
    END IF;
  END LOOP;

  -- Single bulk balance update + ledger row if anything got credited
  IF v_total_credited > 0 THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_total_credited
    WHERE id = p_user_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, description)
    VALUES (
      p_user_id, 'commission_release', v_total_credited, v_new_balance,
      'Agent activated — $' || ROUND(v_total_credited, 2)
      || ' in escrowed commissions released (resolved-market commissions only)'
    );
  END IF;

  RETURN v_total_credited;
END;
$$;

-- ============================================================
-- §4. Market status trigger — sweep pending commissions on resolve/void
--
-- Fires AFTER UPDATE OF status on markets. Two transitions matter:
--   - NEW.status = 'resolved' → release pending commissions (via §2 helper)
--   - NEW.status = 'voided'   → flip pending → voided (no balance change;
--                               pending commissions were never in balance)
--
-- Existing credited-commission clawback during void is handled by
-- _void_market_internal (unchanged) — it runs BEFORE the status update,
-- so by the time this trigger fires the clawback is already done.
-- ============================================================

CREATE OR REPLACE FUNCTION _on_market_status_change_release_commissions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Transition into 'resolved' → release pending commissions for this market
  IF NEW.status = 'resolved' AND (OLD.status IS NULL OR OLD.status <> 'resolved') THEN
    PERFORM _release_pending_commissions_for_market(NEW.id);
  END IF;

  -- Transition into 'voided' → sweep pending → voided (no balance change)
  IF NEW.status = 'voided' AND (OLD.status IS NULL OR OLD.status <> 'voided') THEN
    UPDATE referral_commissions
    SET status = 'voided'
    WHERE market_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS markets_commission_release_on_status_change ON markets;
CREATE TRIGGER markets_commission_release_on_status_change
  AFTER UPDATE OF status ON markets
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION _on_market_status_change_release_commissions();

-- ============================================================
-- §5. Backfill — unlock existing locked commissions
--
-- Per user direction: unlock everything right now. The cliff is one-time;
-- going forward all new commissions follow release-at-resolution.
--
-- We don't flip statuses backwards (no 'credited' → 'pending'). Currently-
-- credited rows stay credited; they're already in agent_balance_usd and
-- agents can transfer them after this migration applies.
-- ============================================================

UPDATE referral_commissions
SET unlock_at = NULL
WHERE unlock_at IS NOT NULL;

-- ============================================================
-- §6. Drop the now-obsolete unlock_at index if it exists
--
-- unlock_at is no longer the release gate (status is). The index from
-- mig 250 served queries like "WHERE unlock_at <= NOW()" which are no
-- longer the hot path. Safe to drop; no other queries rely on it.
-- ============================================================

DROP INDEX IF EXISTS idx_referral_commissions_unlock_at;

COMMIT;
