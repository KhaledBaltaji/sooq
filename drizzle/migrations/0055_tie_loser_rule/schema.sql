-- ============================================================================
-- Migration 0055 — 1m tie-loser settlement rule
-- ============================================================================
--
-- Eliminates the ~18% push (at_strike refund) outcome rate on 1m markets
-- by replacing the push refund with a heavy-side-loses rule on literal
-- ties (close == strike). 5m and 1h markets are untouched.
--
-- Why ties happen: Binance bookTicker quotes BTCUSDT to 2dp (cents). On
-- calm tape, the price often doesn't move a cent in a 60-second window,
-- so the close tick (captured at closes_at) ends up exactly equal to the
-- strike tick (captured at opens_at). Today this refunds everyone. New
-- behavior: pick the heavier-stake side as the loser. Disclosed in T&C.
--
-- Design properties:
--   - Real strike, real chart, real close tick. No threshold offsets, no
--     manipulation — just a tie-breaking rule.
--   - Snapshot at market open (speed_markets.tie_loser_rule_active).
--     Flipping the config flag affects only NEW markets; in-flight
--     markets always settle under the rule they opened with.
--   - Cashed-out positions excluded from the bias direction calculation
--     (status='open' only).
--   - Deterministic loser selection via md5(market_id) hash on fallback
--     paths (low total stake, exact 50/50). Re-resolution is idempotent.
--
-- Activation flags ship OFF. Khaled flips per-market via /admin/markets-config
-- once trade-ticket disclosure surface lands.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) speed_market_config — per-market config columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_market_config
  ADD COLUMN IF NOT EXISTS tie_loser_rule_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE speed_market_config
  ADD COLUMN IF NOT EXISTS tie_low_stake_threshold_usd NUMERIC NOT NULL DEFAULT 200
    CHECK (tie_low_stake_threshold_usd >= 0);

COMMENT ON COLUMN speed_market_config.tie_loser_rule_enabled IS
  '0055: master flag for tie-loser rule on this (asset, duration). Read at MARKET CREATION (speed_roll_markets), snapshotted onto speed_markets.tie_loser_rule_active. Live flips only affect NEW markets — in-flight markets settle under their own snapshot. Default FALSE; ship dark.';

COMMENT ON COLUMN speed_market_config.tie_low_stake_threshold_usd IS
  '0055: when total open-position stake at close < this threshold, tie outcomes use a deterministic-from-md5(market_id) fallback (no bias). Default $200.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) speed_markets — snapshot column
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_markets
  ADD COLUMN IF NOT EXISTS tie_loser_rule_active BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN speed_markets.tie_loser_rule_active IS
  '0055: snapshotted at market creation from speed_market_config.tie_loser_rule_enabled. Determines settlement rule for THIS market regardless of later config flips.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) speed_market_settlement_audit — observability columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_market_settlement_audit
  ADD COLUMN IF NOT EXISTS tie_rule_applied BOOLEAN;

ALTER TABLE speed_market_settlement_audit
  ADD COLUMN IF NOT EXISTS tie_loser_side speed_side;

ALTER TABLE speed_market_settlement_audit
  ADD COLUMN IF NOT EXISTS tie_imbalance_ratio NUMERIC;

ALTER TABLE speed_market_settlement_audit
  ADD COLUMN IF NOT EXISTS tie_total_stake_usd NUMERIC;

ALTER TABLE speed_market_settlement_audit
  ADD COLUMN IF NOT EXISTS tie_basis TEXT
    CHECK (tie_basis IS NULL OR tie_basis IN ('imbalance','deterministic_low_stake','deterministic_balanced'));

COMMENT ON COLUMN speed_market_settlement_audit.tie_rule_applied IS
  '0055: TRUE iff tie_loser_rule_active=TRUE AND v_settlement_price=strike (rule actually fired). FALSE if rule was active but no tie. NULL if rule not active.';

COMMENT ON COLUMN speed_market_settlement_audit.tie_loser_side IS
  '0055: which side was forced to lose on tie. NULL when tie_rule_applied is not TRUE.';

COMMENT ON COLUMN speed_market_settlement_audit.tie_imbalance_ratio IS
  '0055: heavy_side_stake / total_stake at close. NULL when tie_basis is a deterministic fallback or rule did not apply.';

COMMENT ON COLUMN speed_market_settlement_audit.tie_total_stake_usd IS
  '0055: total stake (over+under, status=open) at close. NULL when rule did not apply.';

COMMENT ON COLUMN speed_market_settlement_audit.tie_basis IS
  '0055: how the loser was chosen — imbalance | deterministic_low_stake | deterministic_balanced. NULL when rule did not apply.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Sanity log
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_btc_1m_present  BOOLEAN;
  v_btc_1m_enabled  BOOLEAN;
  v_open_1m         INTEGER;
BEGIN
  SELECT EXISTS(SELECT 1 FROM speed_market_config WHERE asset='BTC' AND duration='1m'),
         COALESCE((SELECT tie_loser_rule_enabled FROM speed_market_config WHERE asset='BTC' AND duration='1m'), FALSE)
    INTO v_btc_1m_present, v_btc_1m_enabled;
  SELECT COUNT(*) INTO v_open_1m FROM speed_markets WHERE duration='1m' AND status='open';
  RAISE NOTICE 'Mig 0055: BTC-1m row present=%, tie_loser_rule_enabled=% (default FALSE), open 1m markets=% (will settle as legacy push because their snapshot=FALSE).',
    v_btc_1m_present, v_btc_1m_enabled, v_open_1m;
END $$;
