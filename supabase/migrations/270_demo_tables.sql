-- 270_demo_tables.sql — Demo Mode: isolated demo_* tables + users demo_* columns
--
-- Demo Mode gives users a $10K sandbox that mirrors live trading mechanics without
-- touching real money. The architecture uses fully isolated `demo_*` tables rather
-- than `is_demo` flags. This preserves live ledger invariants (SUM(transactions) =
-- users.balance_usd), commission tree, revenue stats, and leaderboard aggregations.
--
-- Route-level isolation: only pages under `/demo/*` read from `demo_*` tables.
-- Live pages never query demo tables and vice-versa. This eliminates the audit
-- step and the "live page accidentally fetching demo data" failure class.
--
-- Security model:
--   - demo_market_scheduled_outcomes is admin-only (holds the answer key)
--   - demo_markets itself is authenticated-read (users see the countdown but not outcome)
--   - demo_positions/trades/transactions are own-row-only
--   - users.demo_balance_usd and all other *_at analytics columns are trigger-protected
--     (only SECURITY DEFINER RPCs and service_role can write)

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Enums — keep live transaction_type pure by introducing a separate enum
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE demo_transaction_type AS ENUM (
  'demo_bet',    -- debit on buy / credit on sell
  'demo_win',    -- credit on resolution
  'demo_reset',  -- credit/debit when user resets balance to 10K
  'demo_seed'   -- initial $10K grant at first enable
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. users — demo_* columns (preference + balance + conversion analytics)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- demo_mode           : user-writable preference flag (no balance effect)
-- demo_balance_usd    : DECIMAL(18,6) to match live balance_usd precision exactly
--                       — prevents rounding drift on LMSR trade math
-- demo_first_enabled_at : the REAL gate — "/demo/* route access" checks this,
--                       NOT demo_mode. Set atomically by toggle_demo_mode RPC
--                       when granting the initial $10K balance.
-- demo_first_trade_at : set on first successful demo trade (analytics)
-- first_real_deposit_after_demo_at : set when demo-enabled user makes their
--                       first real deposit (conversion funnel analytics)

ALTER TABLE users
  ADD COLUMN demo_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN demo_balance_usd DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN demo_first_enabled_at TIMESTAMPTZ,
  ADD COLUMN demo_first_trade_at TIMESTAMPTZ,
  ADD COLUMN first_real_deposit_after_demo_at TIMESTAMPTZ;

COMMENT ON COLUMN users.demo_mode IS
  'User-writable preference flag. Does NOT grant demo balance on its own. /demo/* route gate is demo_first_enabled_at IS NOT NULL.';
COMMENT ON COLUMN users.demo_balance_usd IS
  'Demo sandbox balance. DECIMAL(18,6) to match live balance_usd precision.';
COMMENT ON COLUMN users.demo_first_enabled_at IS
  'Set atomically by toggle_demo_mode RPC on first enable. Source of truth for "demo initialized for this user".';
COMMENT ON COLUMN users.demo_first_trade_at IS
  'Set by demo_execute_trade on first successful demo trade. Null-guarded for idempotency.';
COMMENT ON COLUMN users.first_real_deposit_after_demo_at IS
  'Set by process_deposit on first real deposit for users who previously enabled demo. Conversion funnel metric.';

-- Partial index for conversion analytics scan (only demo-enabled users)
CREATE INDEX idx_users_demo_first_enabled
  ON users(demo_first_enabled_at)
  WHERE demo_first_enabled_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. prevent_sensitive_user_updates — extend to block demo_* writes by users
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Critical: without this extension, any user could
--   UPDATE users SET demo_balance_usd = 9999999 WHERE id = auth.uid()
-- and bypass every RPC. The trigger early-returns for service_role (auth.uid IS NULL),
-- admins, and SECURITY DEFINER contexts (app.trigger_bypass=true), so RPCs keep working.
--
-- demo_mode is intentionally NOT in the blocklist — it's a user-writable preference,
-- and route gating is on demo_first_enabled_at anyway.

CREATE OR REPLACE FUNCTION prevent_sensitive_user_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when called via service_role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions (they set a local flag)
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive columns for regular users
  -- NOTE: referred_by is intentionally NOT listed — users can set it once via referral signup
  -- NOTE: demo_mode is intentionally NOT listed — user preference, route gate is elsewhere
  IF NEW.balance_usd        IS DISTINCT FROM OLD.balance_usd
  OR NEW.is_admin           IS DISTINCT FROM OLD.is_admin
  OR NEW.is_frozen          IS DISTINCT FROM OLD.is_frozen
  OR NEW.agent_level        IS DISTINCT FROM OLD.agent_level
  OR NEW.direct_referral_count IS DISTINCT FROM OLD.direct_referral_count
  OR NEW.wagering_requirement  IS DISTINCT FROM OLD.wagering_requirement
  OR NEW.total_wagered      IS DISTINCT FROM OLD.total_wagered
  OR NEW.deposit_bonus_claimed IS DISTINCT FROM OLD.deposit_bonus_claimed
  OR NEW.referral_chain     IS DISTINCT FROM OLD.referral_chain
  OR NEW.referral_code      IS DISTINCT FROM OLD.referral_code
  OR NEW.admin_allowed_views IS DISTINCT FROM OLD.admin_allowed_views
  OR NEW.demo_balance_usd            IS DISTINCT FROM OLD.demo_balance_usd
  OR NEW.demo_first_enabled_at       IS DISTINCT FROM OLD.demo_first_enabled_at
  OR NEW.demo_first_trade_at         IS DISTINCT FROM OLD.demo_first_trade_at
  OR NEW.first_real_deposit_after_demo_at IS DISTINCT FROM OLD.first_real_deposit_after_demo_at
  THEN
    RAISE EXCEPTION 'Cannot modify protected columns';
  END IF;

  -- Extra guard: referred_by can only go from NULL to non-NULL (one-time set)
  IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Cannot modify referred_by after initial set';
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. demo_markets — mirrors current markets shape
-- ═══════════════════════════════════════════════════════════════════════════
--
-- resolves_at lives HERE (denormalized) so users can see a countdown without
-- being able to see the scheduled outcome. The outcome is in a separate
-- admin-only table.
-- resolution_fee_rate_snapshot = 0 for demo (no resolution fee in sandbox).

CREATE TABLE demo_markets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_en    TEXT NOT NULL,
  question_ar    TEXT NOT NULL,
  description_en TEXT,
  description_ar TEXT,
  category       TEXT NOT NULL DEFAULT 'politics',
  status         market_status NOT NULL DEFAULT 'open',
  outcome        bet_side,
  amm_liquidity_param DECIMAL(18,6) NOT NULL DEFAULT 5000,
  trade_count    INTEGER NOT NULL DEFAULT 0,
  unique_traders INTEGER NOT NULL DEFAULT 0,
  homepage_rank  INTEGER,
  opens_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closes_at      TIMESTAMPTZ NOT NULL,
  resolves_at    TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  created_by     UUID NOT NULL REFERENCES users(id),
  keywords       TEXT[] NOT NULL DEFAULT '{}',
  image_url      TEXT,
  short_code     VARCHAR(8) UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  resolution_fee_rate_snapshot DECIMAL(8,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demo_closes_after_opens CHECK (closes_at > opens_at),
  CONSTRAINT demo_resolves_after_closes CHECK (resolves_at >= closes_at)
);

CREATE INDEX idx_demo_markets_status ON demo_markets(status);
CREATE INDEX idx_demo_markets_closes_at ON demo_markets(closes_at);
CREATE INDEX idx_demo_markets_resolves_at ON demo_markets(resolves_at);
CREATE INDEX idx_demo_markets_category ON demo_markets(category);
CREATE INDEX idx_demo_markets_short_code ON demo_markets(short_code);

CREATE TRIGGER demo_markets_updated_at
  BEFORE UPDATE ON demo_markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON COLUMN demo_markets.resolves_at IS
  'When cron should auto-resolve this market. Denormalized here (not on demo_market_scheduled_outcomes) so users can see the countdown.';
COMMENT ON COLUMN demo_markets.resolution_fee_rate_snapshot IS
  'Always 0 for demo markets — no resolution fee in the sandbox.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. demo_market_scheduled_outcomes — admin-only answer key
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CRITICAL: RLS blocks SELECT for all authenticated users (regular AND non-admin).
-- Only service_role and is_admin = TRUE users can read. Admins access via the
-- admin_list_demo_markets_with_outcomes SECURITY DEFINER RPC.

CREATE TABLE demo_market_scheduled_outcomes (
  market_id          UUID PRIMARY KEY REFERENCES demo_markets(id) ON DELETE CASCADE,
  scheduled_outcome  bet_side NOT NULL,
  created_by         UUID NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for cron JOIN (cron filters by resolves_at, but scheduled_outcome is read
-- on resolution — the JOIN is always by market_id which is the PK here).
CREATE INDEX idx_demo_scheduled_outcomes_created ON demo_market_scheduled_outcomes(created_at);

COMMENT ON TABLE demo_market_scheduled_outcomes IS
  'Admin-only answer key for demo markets. Never readable by end users.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. demo_amm_state — mirrors amm_state; default b = 5000 (5x live depth)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE demo_amm_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id      UUID NOT NULL REFERENCES demo_markets(id) ON DELETE CASCADE,
  liquidity_param DECIMAL(18,6) NOT NULL DEFAULT 5000,
  q_yes          DECIMAL(18,6) NOT NULL DEFAULT 0,
  q_no           DECIMAL(18,6) NOT NULL DEFAULT 0,
  current_yes_price DECIMAL(10,6) NOT NULL DEFAULT 0.500000,
  current_no_price  DECIMAL(10,6) NOT NULL DEFAULT 0.500000,
  total_volume   DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_trades   INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demo_amm_state_market_unique UNIQUE (market_id),
  CONSTRAINT demo_amm_prices_valid CHECK (
    current_yes_price >= 0.000001 AND current_yes_price <= 0.999999 AND
    current_no_price >= 0.000001 AND current_no_price <= 0.999999
  ),
  CONSTRAINT demo_amm_liquidity_positive CHECK (liquidity_param > 0)
);

CREATE INDEX idx_demo_amm_state_market ON demo_amm_state(market_id);

CREATE TRIGGER demo_amm_state_updated_at
  BEFORE UPDATE ON demo_amm_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. demo_positions — mirrors positions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE demo_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id       UUID NOT NULL REFERENCES demo_markets(id) ON DELETE CASCADE,
  side            bet_side NOT NULL,
  shares_held     DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (shares_held >= 0),
  avg_entry_price DECIMAL(10,6) NOT NULL DEFAULT 0,
  total_invested  DECIMAL(18,2) NOT NULL DEFAULT 0,
  realized_pnl    DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demo_positions_user_market_side_unique UNIQUE (user_id, market_id, side)
);

CREATE INDEX idx_demo_positions_user ON demo_positions(user_id);
CREATE INDEX idx_demo_positions_market ON demo_positions(market_id);
CREATE INDEX idx_demo_positions_user_market ON demo_positions(user_id, market_id);
CREATE INDEX idx_demo_positions_active ON demo_positions(user_id) WHERE shares_held > 0;

CREATE TRIGGER demo_positions_updated_at
  BEFORE UPDATE ON demo_positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. demo_trades — mirrors trades; used for price-history chart + audit trail
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE demo_trades (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id        UUID NOT NULL REFERENCES demo_markets(id) ON DELETE CASCADE,
  side             bet_side NOT NULL,
  direction        trade_direction NOT NULL,
  shares           DECIMAL(18,6) NOT NULL CHECK (shares > 0),
  price_per_share  DECIMAL(10,6) NOT NULL CHECK (price_per_share > 0 AND price_per_share < 1),
  total_cost       DECIMAL(18,2) NOT NULL,
  post_yes_price   DECIMAL(10,6),
  post_no_price    DECIMAL(10,6),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demo_trades_user ON demo_trades(user_id);
CREATE INDEX idx_demo_trades_market ON demo_trades(market_id);
CREATE INDEX idx_demo_trades_user_market ON demo_trades(user_id, market_id);
CREATE INDEX idx_demo_trades_market_created ON demo_trades(market_id, created_at DESC);
CREATE INDEX idx_demo_trades_user_created ON demo_trades(user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. demo_transactions — append-only ledger (separate enum keeps live pure)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE demo_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          demo_transaction_type NOT NULL,
  amount        DECIMAL(18,6) NOT NULL,  -- positive = credit, negative = debit
  balance_after DECIMAL(18,6) NOT NULL,
  reference_id  UUID,  -- demo_trade_id, demo_market_id, etc.
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_demo_transactions_user ON demo_transactions(user_id);
CREATE INDEX idx_demo_transactions_type ON demo_transactions(type);
CREATE INDEX idx_demo_transactions_reference ON demo_transactions(reference_id);
CREATE INDEX idx_demo_transactions_user_created ON demo_transactions(user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE demo_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_market_scheduled_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_amm_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_transactions ENABLE ROW LEVEL SECURITY;

-- ─── demo_markets: authenticated read; admin write ────────────────────────
CREATE POLICY "demo_markets select authenticated"
  ON demo_markets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "demo_markets admin write"
  ON demo_markets FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── demo_market_scheduled_outcomes: admin-only (blocks SELECT for users) ─
CREATE POLICY "demo_scheduled_outcomes admin only"
  ON demo_market_scheduled_outcomes FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── demo_amm_state: authenticated read (prices must be visible); DEFINER writes ──
CREATE POLICY "demo_amm_state select authenticated"
  ON demo_amm_state FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "demo_amm_state admin all"
  ON demo_amm_state FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── demo_positions: own rows + admin read; writes via SECURITY DEFINER RPCs only ─
CREATE POLICY "demo_positions select own or admin"
  ON demo_positions FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "demo_positions admin all"
  ON demo_positions FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── demo_trades: own rows + admin read ───────────────────────────────────
CREATE POLICY "demo_trades select own or admin"
  ON demo_trades FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "demo_trades admin all"
  ON demo_trades FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── demo_transactions: own rows + admin read ─────────────────────────────
CREATE POLICY "demo_transactions select own or admin"
  ON demo_transactions FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "demo_transactions admin all"
  ON demo_transactions FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Realtime publication — price/position updates must stream
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Demo hooks subscribe to these channels with the same disconnect/reconnect
-- logic as live hooks.

ALTER PUBLICATION supabase_realtime ADD TABLE demo_markets;
ALTER PUBLICATION supabase_realtime ADD TABLE demo_amm_state;
ALTER PUBLICATION supabase_realtime ADD TABLE demo_positions;

COMMIT;
