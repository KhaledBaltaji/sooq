-- ============================================================================
-- 317_speed_fee_config_seeds.sql
--
-- Seeds all speed-market-specific fee_config rows.
--
-- Rows added:
-- - Pricing constants: handle fee, spread, oracle thresholds, master kill flag
-- - 24 cashout multipliers (4 durations × 3 time buckets × 2 roles)
-- - 12 commission rates (copies of existing ngr_commission rates, keyed under
--   speed_ngr_commission so the speed RPC can look them up separately)
-- - speed_iv_btc: implied volatility for Black-Scholes (Phase 1 hardcoded)
--
-- Per-branch parameters (collateral, fee_share_pct, freeze thresholds, stake
-- caps) are NOT in fee_config — they live on speed_branches per-row, set
-- by admin at enable.
--
-- Idempotency: deletes any existing speed_* rows first, then inserts. Safe to re-run.
-- ============================================================================

-- Idempotent cleanup before insert
DELETE FROM fee_config WHERE fee_type LIKE 'speed_%';

INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES

-- ── Pricing constants ──────────────────────────────────────────────────────
  ('speed_handle_fee_pct',     NULL, NULL, 0.01,  'Speed handle fee (1.0%) — taken off every bet, regardless of outcome'),
  ('speed_spread_pct',         NULL, NULL, 0.04,  'Speed market spread (4%). Offered probability = fair + spread/2 on each side.'),
  ('speed_iv_btc',             NULL, NULL, 0.60,  'Implied volatility for Black-Scholes binary pricing on BTC (Phase 1 hardcoded; refine later from realized vol)'),

-- ── Oracle / TWAP ──────────────────────────────────────────────────────────
  ('speed_oracle_stale_seconds', NULL, NULL, 2,   'Tick stale threshold (sec). Speed RPC rejects new trades when last tick > this.'),
  ('speed_twap_window_seconds',  NULL, NULL, 30,  'TWAP averaging window before expiry (sec).'),

-- ── Master kill switch ─────────────────────────────────────────────────────
  ('speed_markets_enabled',    NULL, NULL, 1,     'Master enable flag. 1=active. 0=halted (no new bets, existing positions resolve normally — soft kill).'),

-- ── Cashout multipliers (24 rows: 4 durations × 3 time buckets × 2 roles) ──
-- 5m markets
  ('speed_cashout_5m_winner_high',  NULL, NULL, 0.65, '5m: >60% time left, winner'),
  ('speed_cashout_5m_loser_high',   NULL, NULL, 0.55, '5m: >60% time left, loser'),
  ('speed_cashout_5m_winner_mid',   NULL, NULL, 0.45, '5m: 20-60% time left, winner'),
  ('speed_cashout_5m_loser_mid',    NULL, NULL, 0.35, '5m: 20-60% time left, loser'),
  ('speed_cashout_5m_winner_low',   NULL, NULL, 0.25, '5m: <20% time left, winner'),
  ('speed_cashout_5m_loser_low',    NULL, NULL, 0.15, '5m: <20% time left, loser'),
-- 15m markets
  ('speed_cashout_15m_winner_high', NULL, NULL, 0.75, '15m: >60% time left, winner'),
  ('speed_cashout_15m_loser_high',  NULL, NULL, 0.65, '15m: >60% time left, loser'),
  ('speed_cashout_15m_winner_mid',  NULL, NULL, 0.55, '15m: 20-60% time left, winner'),
  ('speed_cashout_15m_loser_mid',   NULL, NULL, 0.45, '15m: 20-60% time left, loser'),
  ('speed_cashout_15m_winner_low',  NULL, NULL, 0.35, '15m: <20% time left, winner'),
  ('speed_cashout_15m_loser_low',   NULL, NULL, 0.25, '15m: <20% time left, loser'),
-- 1h markets
  ('speed_cashout_1h_winner_high',  NULL, NULL, 0.80, '1h: >60% time left, winner'),
  ('speed_cashout_1h_loser_high',   NULL, NULL, 0.70, '1h: >60% time left, loser'),
  ('speed_cashout_1h_winner_mid',   NULL, NULL, 0.65, '1h: 20-60% time left, winner'),
  ('speed_cashout_1h_loser_mid',    NULL, NULL, 0.55, '1h: 20-60% time left, loser'),
  ('speed_cashout_1h_winner_low',   NULL, NULL, 0.45, '1h: <20% time left, winner'),
  ('speed_cashout_1h_loser_low',    NULL, NULL, 0.35, '1h: <20% time left, loser'),
-- 24h markets
  ('speed_cashout_24h_winner_high', NULL, NULL, 0.85, '24h: >60% time left, winner'),
  ('speed_cashout_24h_loser_high',  NULL, NULL, 0.75, '24h: >60% time left, loser'),
  ('speed_cashout_24h_winner_mid',  NULL, NULL, 0.70, '24h: 20-60% time left, winner'),
  ('speed_cashout_24h_loser_mid',   NULL, NULL, 0.60, '24h: 20-60% time left, loser'),
  ('speed_cashout_24h_winner_low',  NULL, NULL, 0.50, '24h: <20% time left, winner'),
  ('speed_cashout_24h_loser_low',   NULL, NULL, 0.40, '24h: <20% time left, loser');

-- ── Speed commission rates (mirror existing ngr_commission table) ──────────
-- Copy the existing ngr_commission rates into speed_ngr_commission so the
-- speed RPC can look them up under a distinct fee_type without affecting
-- the existing prediction commission walk.
INSERT INTO fee_config (fee_type, level, depth, rate, description)
SELECT
  'speed_ngr_commission',
  level,
  depth,
  rate,
  'Speed agent commission rate at level ' || level || ' depth ' || depth || ' (copied from ngr_commission)'
FROM fee_config
WHERE fee_type = 'ngr_commission';

-- Confirmation log (won't run if the script is idempotent-applied)
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type LIKE 'speed_%';
  RAISE NOTICE 'speed_* fee_config rows present: %', v_count;
END $$;
