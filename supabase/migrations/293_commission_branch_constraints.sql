-- ============================================================
-- 293: Commission Branch — Phase 2: Constraints + attribution column + admin RPC
--
-- Adds all the guards + plumbing that make 'commission' branches safe and
-- usable. Builds on mig 289 (which added the 'commission' enum value).
--
-- Depends on:
--   - 289 — added 'commission' to branch_book_type enum (also creates the
--     enum itself if missing, idempotent on both staging and fresh prod)
--   - 291 (bookmaker park) — kept the multi-branch-type foundation:
--     `branches.book_type` column, `_protect_branch_book_type` trigger,
--     `idx_branches_book_type` index. Also DROPPED `users.venue_type` and
--     `users.assigned_branch_id` (bookmaker-era columns).
--
-- Scope:
--   §1. `users.signup_branch_id` column + partial index + FK ON DELETE RESTRICT
--       (cheap "my users" dashboard queries; distinct attribution path for
--        commission branches, which don't use venue-lock)
--   §2. `branches_commission_no_capital` CHECK
--       (pool/markup/fee fields all zero for commission branches)
--   §3. `branches_commission_no_payback` CHECK
--       (commission branches cannot enter payback mode)
--   §4. `branches_commission_slug_format` CHECK
--       (3-20 lowercase alphanum + hyphen, no leading/trailing hyphen; applies
--        ONLY to commission branches — legacy reseller slugs grandfathered)
--   §5. `_reserved_slugs()` helper + trigger
--       (blocklist of reserved URL-route slugs; applies to all branches to
--        prevent legacy-slug resellers from grabbing reserved words on update)
--   §6. `branch_agents` trigger BEFORE INSERT OR UPDATE
--       (commission branches: agent_type must be 'commission' and
--        deposit_required/deposit_held must be zero)
--   §7. `admin_create_branch` RPC extension
--       (accepts p_book_type default 'reseller'; p_slug validated and unique)
--   §8. `branch_dashboard_stats` RPC extension
--       (dispatches on book_type; commission branches return commission
--        stats from referral system, not pool/solvency)
--
-- Plan: /Users/khaledbaltaji/.claude/plans/wtf-ru-doing-dont-recursive-thompson.md
-- Design: docs/designs/commission-branch.md
-- ============================================================

BEGIN;

-- ============================================================
-- §1. users.signup_branch_id — attribution column
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_branch_id UUID NULL
    REFERENCES branches(id) ON DELETE RESTRICT;

COMMENT ON COLUMN users.signup_branch_id IS
  'Branch through which this user signed up. Populated by the signup resolver for commission-branch signups (via /b/[slug]/ or /b/[slug]/?agent=[code]). Powers the branch manager dashboard "my users" query. ON DELETE RESTRICT: cannot delete a branch with attributed users; admin must suspend instead.';

-- Partial index for the dashboard "my users" query
CREATE INDEX IF NOT EXISTS idx_users_signup_branch
  ON users(signup_branch_id)
  WHERE signup_branch_id IS NOT NULL;

-- ============================================================
-- §2. branches_commission_no_capital CHECK
--
-- Commission branches never hold capital, never price trades. All pool-related
-- and pricing-related fields must be zero.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branches_commission_no_capital'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT branches_commission_no_capital
      CHECK (
        book_type <> 'commission' OR (
          pool_balance = 0
          AND worst_case_total = 0
          AND pending_payouts = 0
          AND yes_markup_pct = 0
          AND no_markup_pct = 0
          AND exit_fee_pct = 0
          AND branch_fee_rate = 0
          AND solvency_override_pct IS NULL
          AND solvency_override_until IS NULL
        )
      );
  END IF;
END$$;

-- ============================================================
-- §3. branches_commission_no_payback CHECK
--
-- Commission branches have no pool and no payouts, so payback mode is
-- architecturally impossible. Defense in depth: reject it at the DB layer
-- in case admin_update_branch_status is ever extended incorrectly.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branches_commission_no_payback'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT branches_commission_no_payback
      CHECK (
        book_type <> 'commission' OR status <> 'payback'
      );
  END IF;
END$$;

-- ============================================================
-- §4. branches_commission_slug_format CHECK
--
-- Commission branch slugs are public URL slugs (e.g. /b/alice-sports) and
-- must match strict format rules. The regex literal here MUST match
-- src/lib/slug-rules.ts's SLUG_REGEX — if you change one, change both.
--
-- Legacy reseller slugs that don't match the format are grandfathered
-- (the CHECK only applies to book_type='commission').
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'branches_commission_slug_format'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT branches_commission_slug_format
      CHECK (
        book_type <> 'commission'
        OR branch_code ~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$'
      );
  END IF;
END$$;

-- ============================================================
-- §5. _reserved_slugs() helper + trigger
--
-- Centralized blocklist for reserved URL-route slugs. Applied to ALL branch
-- types (not just commission) to prevent anyone from grabbing 'admin',
-- 'api', etc. The reserved list MUST match src/lib/slug-rules.ts's
-- RESERVED_SLUGS array — if you change one, change both.
--
-- Applied as a trigger (not a CHECK) because CHECKs can't easily reference a
-- function call in a way that's portable across Postgres versions.
-- ============================================================

CREATE OR REPLACE FUNCTION _reserved_slugs()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'admin', 'api', 'app', 'auth',
    'b', 'branch', 'branches',
    'dashboard', 'demo',
    'help', 'home',
    'login', 'logout',
    'market', 'markets',
    'r', 'referral', 'referrals',
    'settings', 'signup', 'signin', 'sooq', 'support',
    'terms', 'privacy'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION _reserved_slugs() IS
  'Reserved branch slugs — mirrors RESERVED_SLUGS in src/lib/slug-rules.ts. Update both together.';

CREATE OR REPLACE FUNCTION _reject_reserved_branch_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.branch_code = ANY(_reserved_slugs()) THEN
    RAISE EXCEPTION 'Branch slug "%" is reserved', NEW.branch_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS branches_reject_reserved_slug ON branches;
CREATE TRIGGER branches_reject_reserved_slug
  BEFORE INSERT OR UPDATE OF branch_code ON branches
  FOR EACH ROW EXECUTE FUNCTION _reject_reserved_branch_slug();

-- ============================================================
-- §6. branch_agents trigger — commission-branch constraints
--
-- Fires BEFORE INSERT OR UPDATE so post-insert mutations (e.g., flipping
-- agent_type from 'commission' to 'pl') also fail. Commission branches do
-- not carry capital, so sub-agents cannot have deposit_required or
-- deposit_held above zero.
-- ============================================================

CREATE OR REPLACE FUNCTION _enforce_commission_branch_agent_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_book_type branch_book_type;
BEGIN
  SELECT book_type INTO v_book_type
  FROM branches
  WHERE id = NEW.branch_id;

  IF v_book_type = 'commission' THEN
    IF NEW.agent_type <> 'commission' THEN
      RAISE EXCEPTION 'Commission branches accept commission-type agents only (got %)', NEW.agent_type
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.deposit_required IS DISTINCT FROM 0 OR NEW.deposit_held IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Commission branches require zero deposit (got required=%, held=%)',
        NEW.deposit_required, NEW.deposit_held
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS branch_agents_commission_rules ON branch_agents;
CREATE TRIGGER branch_agents_commission_rules
  BEFORE INSERT OR UPDATE ON branch_agents
  FOR EACH ROW EXECUTE FUNCTION _enforce_commission_branch_agent_rules();

-- ============================================================
-- §7. admin_create_branch — extend for commission + slug validation
--
-- New parameters:
--   p_book_type — 'reseller' (default, preserves existing callers) | 'commission'
--                 'bookmaker' is rejected (parked via mig 291)
-- Slug format validation happens pre-insert so we return a friendly error
-- instead of relying on the DB CHECK (which would fire a less useful
-- check_violation).
-- ============================================================

CREATE OR REPLACE FUNCTION admin_create_branch(
  p_name TEXT,
  p_code TEXT,
  p_manager_user_id UUID,
  p_config JSONB DEFAULT '{}',
  p_pin TEXT DEFAULT NULL,
  p_book_type TEXT DEFAULT 'reseller'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch_id UUID;
  v_book_type branch_book_type;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- PIN required for branch creation
  IF p_pin IS NOT NULL THEN
    PERFORM _verify_admin_pin(v_admin_id, p_pin);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Unauthorized: not an admin';
    END IF;
  END IF;

  -- Validate + coerce book_type
  IF p_book_type NOT IN ('reseller', 'commission') THEN
    RAISE EXCEPTION 'Invalid book_type: %. Allowed: reseller, commission (bookmaker is parked).', p_book_type;
  END IF;
  v_book_type := p_book_type::branch_book_type;

  -- Validate manager exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_manager_user_id) THEN
    RAISE EXCEPTION 'Manager user not found';
  END IF;

  -- Validate slug format for commission branches (friendly errors; DB CHECK is belt + suspenders)
  IF v_book_type = 'commission' THEN
    IF p_code !~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$' THEN
      RAISE EXCEPTION 'Slug must be 3-20 lowercase letters/numbers/hyphens, start and end with letter or number';
    END IF;
    IF p_code = ANY(_reserved_slugs()) THEN
      RAISE EXCEPTION 'Slug "%" is reserved', p_code;
    END IF;
  END IF;

  -- Validate code uniqueness
  IF EXISTS (SELECT 1 FROM branches WHERE branch_code = p_code) THEN
    RAISE EXCEPTION 'Branch code "%" is already in use', p_code;
  END IF;

  -- Create branch with config overrides. Commission branches force all
  -- capital/pricing fields to zero (belt + suspenders against bad config).
  IF v_book_type = 'commission' THEN
    INSERT INTO branches (
      branch_code, name, manager_user_id, book_type,
      yes_markup_pct, no_markup_pct, branch_fee_rate, exit_fee_pct,
      display_mode, cash_out_enabled,
      pool_balance, worst_case_total, pending_payouts
    ) VALUES (
      p_code, p_name, p_manager_user_id, 'commission',
      0, 0, 0, 0,
      'betting', TRUE,
      0, 0, 0
    )
    RETURNING id INTO v_branch_id;
  ELSE
    INSERT INTO branches (
      branch_code, name, manager_user_id, book_type,
      yes_markup_pct, no_markup_pct, branch_fee_rate,
      exit_fee_pct, display_mode, cash_out_enabled,
      default_position_cap_yes, default_position_cap_no
    ) VALUES (
      p_code, p_name, p_manager_user_id, 'reseller',
      COALESCE((p_config->>'yes_markup_pct')::DECIMAL, 0.0500),
      COALESCE((p_config->>'no_markup_pct')::DECIMAL, 0.0500),
      COALESCE((p_config->>'branch_fee_rate')::DECIMAL, 0.050000),
      COALESCE((p_config->>'exit_fee_pct')::DECIMAL, 0.0050),
      COALESCE((p_config->>'display_mode')::branch_display_mode, 'betting'),
      COALESCE((p_config->>'cash_out_enabled')::BOOLEAN, TRUE),
      (p_config->>'default_position_cap_yes')::DECIMAL,
      (p_config->>'default_position_cap_no')::DECIMAL
    )
    RETURNING id INTO v_branch_id;
  END IF;

  -- Reseller branches auto-assign the manager to the branch (venue-lock model).
  -- Commission branches do NOT — users stay retail, attribution flows via
  -- users.signup_branch_id, never branch_user_assignments.
  IF v_book_type = 'reseller' THEN
    INSERT INTO branch_user_assignments (user_id, branch_id)
    VALUES (p_manager_user_id, v_branch_id)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM log_system_event('info'::log_severity, 'branch/created',
    'Branch "' || p_name || '" created (' || p_book_type || ')',
    jsonb_build_object(
      'branch_id', v_branch_id,
      'code', p_code,
      'book_type', p_book_type,
      'manager_id', p_manager_user_id,
      'admin_id', v_admin_id
    )
  );

  RETURN jsonb_build_object(
    'branch_id', v_branch_id,
    'branch_code', p_code,
    'name', p_name,
    'book_type', p_book_type,
    'manager_user_id', p_manager_user_id
  );
END;
$$;

-- ============================================================
-- §8. branch_dashboard_stats — extend for commission branches
--
-- Commission branches don't have pool/volume/solvency stats. Instead they
-- return: attributed user count (via signup_branch_id), sub-agent count
-- (from branch_agents), and commission earnings (pulled from the existing
-- referral system using the manager's user_id).
--
-- The shape of the return jsonb varies by book_type. Callers must check
-- the `book_type` field to interpret the rest.
-- ============================================================

CREATE OR REPLACE FUNCTION branch_dashboard_stats(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_user_count INTEGER;
  v_active_agent_count INTEGER;
  v_trade_count INTEGER;
  v_total_volume DECIMAL;
  v_total_revenue DECIMAL;
  v_trades_last_24h INTEGER;
  v_total_markets INTEGER;
  v_commission_credited DECIMAL;
  v_commission_escrowed DECIMAL;
  v_qualified_referrals INTEGER;
  v_network_volume DECIMAL;
  v_agent_level INTEGER;
  v_agent_activated BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF v_branch.manager_user_id != v_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Access denied: not admin or branch manager';
    END IF;
  END IF;

  IF v_branch.book_type = 'commission' THEN
    -- Commission branch: attributed users, commission sub-agents, earnings from referral system
    SELECT COUNT(*) INTO v_user_count
    FROM users WHERE signup_branch_id = p_branch_id;

    SELECT COUNT(*) INTO v_active_agent_count
    FROM branch_agents
    WHERE branch_id = p_branch_id AND is_active = TRUE;

    -- Commission totals from referral_commissions (manager's own + sub-agents' is
    -- via layer-2 chain; this shows manager's personal earnings only)
    SELECT
      COALESCE(SUM(CASE WHEN status = 'credited' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'escrowed' THEN amount ELSE 0 END), 0)
    INTO v_commission_credited, v_commission_escrowed
    FROM referral_commissions
    WHERE agent_user_id = v_branch.manager_user_id;

    -- Manager's agent profile for tier display
    SELECT qualified_referral_count, network_volume, agent_level, agent_activated
    INTO v_qualified_referrals, v_network_volume, v_agent_level, v_agent_activated
    FROM users WHERE id = v_branch.manager_user_id;

    RETURN jsonb_build_object(
      'book_type', 'commission',
      'user_count', v_user_count,
      'active_agent_count', v_active_agent_count,
      'commission_credited', ROUND(v_commission_credited, 2),
      'commission_escrowed', ROUND(v_commission_escrowed, 2),
      'qualified_referral_count', COALESCE(v_qualified_referrals, 0),
      'network_volume', ROUND(COALESCE(v_network_volume, 0), 2),
      'agent_level', COALESCE(v_agent_level, 1),
      'agent_activated', COALESCE(v_agent_activated, FALSE)
    );
  END IF;

  -- Reseller branch (default): existing pool/volume stats
  SELECT COUNT(*) INTO v_user_count
  FROM branch_user_assignments WHERE branch_id = p_branch_id;

  SELECT COUNT(*) INTO v_active_agent_count
  FROM branch_agents WHERE branch_id = p_branch_id AND is_active = TRUE;

  SELECT COUNT(*), COALESCE(SUM(gross_amount), 0)
  INTO v_trade_count, v_total_volume
  FROM branch_trades WHERE branch_id = p_branch_id;

  SELECT COALESCE(SUM(total_revenue), 0) INTO v_total_revenue
  FROM branch_revenue WHERE branch_id = p_branch_id;

  SELECT COUNT(*) INTO v_trades_last_24h
  FROM branch_trades
  WHERE branch_id = p_branch_id AND created_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_total_markets
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND is_enabled = TRUE;

  RETURN jsonb_build_object(
    'book_type', 'reseller',
    'user_count', v_user_count,
    'active_agent_count', v_active_agent_count,
    'trade_count', v_trade_count,
    'total_volume', ROUND(v_total_volume, 2),
    'total_revenue', ROUND(v_total_revenue, 2),
    'trades_last_24h', v_trades_last_24h,
    'active_markets', v_total_markets
  );
END;
$$;

COMMIT;
