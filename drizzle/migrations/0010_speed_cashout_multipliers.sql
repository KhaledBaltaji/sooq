-- 0010_speed_cashout_multipliers.sql
--
-- W9 finding #3 caught by scripts/w9-trade-suite.mjs T8:
-- The cashout RPC composes a fee_config key as:
--   `speed_cashout_<duration>_<role>_<bucket>`
-- and raises EXCEPTION 'Cashout multiplier not configured' if the row is
-- missing. The 18-row matrix was never seeded — neither in 0002, 0004,
-- nor anywhere else. Cashout RPC has been broken since W3.
--
-- Dimensions:
--   duration: 5m, 15m, 24h
--   role:     winner (fair_prob_side >= entry_offered_prob), loser (else)
--   bucket:   high (>=60% of duration left), mid (20–60%), low (<20%)
--
-- Math from the RPC body:
--   winner: cashout = stake + fair_profit * multiplier
--   loser:  cashout = fair_value  * multiplier
--
-- Values target the master plan's documented ~0.5% cash-out premium on
-- average, grading the haircut by time-bucket so positions with less time
-- left (lower bucket) take a bigger haircut. Same values across all three
-- durations for v1 simplicity — the duration dimension exists so future
-- tuning can give 24h positions a different curve from 5m. Per the locked
-- decision "fee values are hardcoded", these are committed-in-migration
-- not admin-editable; future tweaks ship as a new migration.

BEGIN;

INSERT INTO fee_config (fee_type, rate, description) VALUES
  -- 5m bucket × winner / loser × {high, mid, low}
  ('speed_cashout_5m_winner_high',  0.99, '5m, position currently winning, >=60% time left → 1% haircut on profit'),
  ('speed_cashout_5m_winner_mid',   0.97, '5m, currently winning, 20-60% time left → 3% haircut on profit'),
  ('speed_cashout_5m_winner_low',   0.95, '5m, currently winning, <20% time left → 5% haircut on profit'),
  ('speed_cashout_5m_loser_high',   0.97, '5m, currently losing, >=60% time left → 3% haircut on residual fair value'),
  ('speed_cashout_5m_loser_mid',    0.92, '5m, currently losing, 20-60% time left → 8% haircut on residual'),
  ('speed_cashout_5m_loser_low',    0.85, '5m, currently losing, <20% time left → 15% haircut on residual'),

  -- 15m bucket
  ('speed_cashout_15m_winner_high', 0.99, '15m, currently winning, >=60% time left → 1% haircut on profit'),
  ('speed_cashout_15m_winner_mid',  0.97, '15m, currently winning, 20-60% time left → 3% haircut on profit'),
  ('speed_cashout_15m_winner_low',  0.95, '15m, currently winning, <20% time left → 5% haircut on profit'),
  ('speed_cashout_15m_loser_high',  0.97, '15m, currently losing, >=60% time left → 3% haircut on residual'),
  ('speed_cashout_15m_loser_mid',   0.92, '15m, currently losing, 20-60% time left → 8% haircut on residual'),
  ('speed_cashout_15m_loser_low',   0.85, '15m, currently losing, <20% time left → 15% haircut on residual'),

  -- 24h bucket
  ('speed_cashout_24h_winner_high', 0.99, '24h, currently winning, >=60% time left → 1% haircut on profit'),
  ('speed_cashout_24h_winner_mid',  0.97, '24h, currently winning, 20-60% time left → 3% haircut on profit'),
  ('speed_cashout_24h_winner_low',  0.95, '24h, currently winning, <20% time left → 5% haircut on profit'),
  ('speed_cashout_24h_loser_high',  0.97, '24h, currently losing, >=60% time left → 3% haircut on residual'),
  ('speed_cashout_24h_loser_mid',   0.92, '24h, currently losing, 20-60% time left → 8% haircut on residual'),
  ('speed_cashout_24h_loser_low',   0.85, '24h, currently losing, <20% time left → 15% haircut on residual')
ON CONFLICT (fee_type) DO NOTHING;

COMMIT;
