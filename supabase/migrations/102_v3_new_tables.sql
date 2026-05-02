-- 102_v3_new_tables.sql — V3 Migration: Create all new AMM tables

BEGIN;

-- ============================================================
-- 1. amm_state — Per-market AMM state (LMSR)
-- ============================================================

CREATE TABLE amm_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id      UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  liquidity_param DECIMAL(18,6) NOT NULL DEFAULT 1000,
  q_yes          DECIMAL(18,6) NOT NULL DEFAULT 0,
  q_no           DECIMAL(18,6) NOT NULL DEFAULT 0,
  current_yes_price DECIMAL(10,6) NOT NULL DEFAULT 0.500000,
  current_no_price  DECIMAL(10,6) NOT NULL DEFAULT 0.500000,
  total_volume   DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_trades   INTEGER NOT NULL DEFAULT 0,
  seed_pnl       DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT amm_state_market_unique UNIQUE (market_id),
  CONSTRAINT amm_prices_valid CHECK (
    current_yes_price >= 0.000001 AND current_yes_price <= 0.999999 AND
    current_no_price >= 0.000001 AND current_no_price <= 0.999999
  ),
  CONSTRAINT amm_liquidity_positive CHECK (liquidity_param > 0)
);

CREATE INDEX idx_amm_state_market ON amm_state(market_id);

CREATE TRIGGER amm_state_updated_at
  BEFORE UPDATE ON amm_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. trades — All buy/sell transactions
-- ============================================================

CREATE TABLE trades (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  market_id        UUID NOT NULL REFERENCES markets(id),
  side             bet_side NOT NULL,
  direction        trade_direction NOT NULL,
  shares           DECIMAL(18,6) NOT NULL CHECK (shares > 0),
  price_per_share  DECIMAL(10,6) NOT NULL CHECK (price_per_share > 0 AND price_per_share < 1),
  total_cost       DECIMAL(18,2) NOT NULL,
  explicit_fee     DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (explicit_fee >= 0),
  amm_spread_cost  DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (amm_spread_cost >= 0),
  cash_out_premium DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (cash_out_premium >= 0),
  is_copy_trade    BOOLEAN NOT NULL DEFAULT FALSE,
  copied_from_user UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trades_user ON trades(user_id);
CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_user_market ON trades(user_id, market_id);
CREATE INDEX idx_trades_market_side ON trades(market_id, side);
CREATE INDEX idx_trades_created ON trades(created_at DESC);
CREATE INDEX idx_trades_market_created ON trades(market_id, created_at DESC);

-- ============================================================
-- 3. positions — User holdings per market per side
-- ============================================================

CREATE TABLE positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  market_id       UUID NOT NULL REFERENCES markets(id),
  side            bet_side NOT NULL,
  shares_held     DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (shares_held >= 0),
  avg_entry_price DECIMAL(10,6) NOT NULL DEFAULT 0,
  total_invested  DECIMAL(18,2) NOT NULL DEFAULT 0,
  realized_pnl    DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT positions_user_market_side_unique UNIQUE (user_id, market_id, side)
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_market ON positions(market_id);
CREATE INDEX idx_positions_user_market ON positions(user_id, market_id);
CREATE INDEX idx_positions_active ON positions(user_id) WHERE shares_held > 0;

CREATE TRIGGER positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. price_alerts — Price threshold notifications
-- ============================================================

CREATE TABLE price_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  market_id     UUID NOT NULL REFERENCES markets(id),
  side          bet_side NOT NULL,
  target_price  DECIMAL(10,6) NOT NULL CHECK (target_price > 0 AND target_price < 1),
  direction     alert_direction NOT NULL,
  is_triggered  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_at  TIMESTAMPTZ
);

CREATE INDEX idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX idx_price_alerts_active ON price_alerts(market_id, is_active) WHERE is_active = TRUE;

-- ============================================================
-- 5. copy_settings — Copy trading configuration
-- ============================================================

CREATE TABLE copy_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copier_id        UUID NOT NULL REFERENCES users(id),
  leader_id        UUID NOT NULL REFERENCES users(id),
  amount_per_trade DECIMAL(18,2) NOT NULL CHECK (amount_per_trade > 0),
  max_per_market   DECIMAL(18,2) NOT NULL DEFAULT 100,
  max_total        DECIMAL(18,2) NOT NULL DEFAULT 1000,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT copy_settings_unique UNIQUE (copier_id, leader_id),
  CONSTRAINT copy_no_self CHECK (copier_id != leader_id)
);

CREATE INDEX idx_copy_settings_copier ON copy_settings(copier_id);
CREATE INDEX idx_copy_settings_leader ON copy_settings(leader_id);

CREATE TRIGGER copy_settings_updated_at
  BEFORE UPDATE ON copy_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. leader_stats — Leader performance for copy trading
-- ============================================================

CREATE TABLE leader_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  total_trades    INTEGER NOT NULL DEFAULT 0,
  winning_trades  INTEGER NOT NULL DEFAULT 0,
  accuracy_pct    DECIMAL(5,2) NOT NULL DEFAULT 0,
  total_pnl       DECIMAL(18,2) NOT NULL DEFAULT 0,
  copier_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT leader_stats_user_unique UNIQUE (user_id)
);

CREATE INDEX idx_leader_stats_pnl ON leader_stats(total_pnl DESC);
CREATE INDEX idx_leader_stats_accuracy ON leader_stats(accuracy_pct DESC);

CREATE TRIGGER leader_stats_updated_at
  BEFORE UPDATE ON leader_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 7. user_locations — Geolocation data
-- ============================================================

CREATE TABLE user_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  country    TEXT,
  city       TEXT,
  latitude   DECIMAL(10,7),
  longitude  DECIMAL(10,7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_locations_user_unique UNIQUE (user_id)
);

CREATE INDEX idx_user_locations_country ON user_locations(country);

CREATE TRIGGER user_locations_updated_at
  BEFORE UPDATE ON user_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
