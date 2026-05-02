-- ============================================================================
-- 306_speed_enums.sql
--
-- All enums + RLS helper functions used by the speed-markets schema.
-- Consolidated upfront so subsequent migrations can reference them
-- without forward declarations.
--
-- Helper functions is_admin() and is_branch_manager_of() are STABLE
-- SECURITY DEFINER. They allow RLS policies to call them inline,
-- keeping policy bodies short and DRY.
-- ============================================================================

-- ── ENUM types ─────────────────────────────────────────────────────────────

CREATE TYPE speed_asset AS ENUM ('BTC');
-- Future: ALTER TYPE speed_asset ADD VALUE 'ETH', 'XAU', etc. when expanding.

CREATE TYPE speed_duration AS ENUM ('5m', '15m', '1h', '24h');

CREATE TYPE speed_market_status AS ENUM (
  'pending',    -- created but opens_at not yet reached
  'open',       -- accepting trades
  'resolving',  -- expired, settlement in progress
  'resolved',   -- payouts complete
  'voided',     -- oracle outage or admin void; all stakes refunded
  'halted'      -- admin halt; existing positions resolve, no new trades
);

CREATE TYPE speed_market_outcome AS ENUM ('over', 'under', 'at_strike');
-- 'at_strike' means TWAP exactly equal to strike. Both sides LOSE. No refund.

CREATE TYPE speed_position_status AS ENUM (
  'open', 'cashed_out', 'won', 'lost', 'refunded'
);

CREATE TYPE speed_trade_kind AS ENUM ('open', 'cashout');

CREATE TYPE speed_branch_status AS ENUM (
  'inactive', 'active', 'warning', 'frozen', 'suspended'
);

CREATE TYPE speed_pool_entry_type AS ENUM (
  'collateral_credit',           -- admin posts (initial collateral, top-ups)
  'collateral_withdraw',         -- branch withdraws (legacy generic)
  'fee_withdrawal_self',         -- branch self-service withdrawal of fee revenue
  'admin_withdrawal_discretionary', -- admin posts collateral reduction or book P/L payout
  'stake_in',                    -- user opens position; stake adds to pool
  'cashout_out',                 -- user cashes out; pool pays
  'winning_payout',              -- user wins at resolution; pool pays
  'refund',                      -- void: stake returned to user
  'fee_share_in'                 -- branch's % of platform handle fee, real-time per trade
);

-- ── RLS helper functions ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_branch_manager_of(p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM branches WHERE id = p_branch_id AND manager_user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION is_admin() IS
'Returns TRUE if the current auth.uid() user is_admin. STABLE SECURITY DEFINER so RLS policies can inline it.';

COMMENT ON FUNCTION is_branch_manager_of(UUID) IS
'Returns TRUE if the current auth.uid() user is the manager of the given branch_id. Used by all branch-scoped RLS policies on speed_* tables.';
