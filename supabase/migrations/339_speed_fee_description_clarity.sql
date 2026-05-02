-- ============================================================================
-- 339_speed_fee_description_clarity.sql
--
-- Codex finding #2 (LOW SEVERITY) — fee description copy.
--
-- Path A locked decision: 1% handle fee comes OUT OF the stake (not added on
-- top). The implementation in 319_speed_execute_trade is correct (user is
-- debited p_stake exactly, pool ledger records stake_in for full p_stake,
-- the $0.10 handle fee on a $10 bet is conceptually carved off the at-risk
-- portion, never billed extra).
--
-- The original fee_config description for speed_handle_fee_pct was ambiguous,
-- read like "extra fee charged on every bet, regardless of outcome". Risks:
-- support replies confuse users, finance team thinks revenue is logged twice.
--
-- This is a copy-only fix. No RPC logic change. No commission calc change.
-- Updates the description to match Path A reality.
-- ============================================================================

UPDATE fee_config
SET description = 'Handle fee taken from each bet stake. 1% of stake retained as platform revenue regardless of outcome. NOT charged on top — already included in the stake the user pays.'
WHERE fee_type = 'speed_handle_fee_pct';

UPDATE fee_config
SET description = 'House spread on speed-market pricing. Offered probabilities = fair_prob ± spread/2 per side, so sum of UP + DOWN exceeds 100% by spread amount (sportsbook overround convention). Platform edge from this gap captured at trade time.'
WHERE fee_type = 'speed_spread_pct';
