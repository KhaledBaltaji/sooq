-- ============================================================================
-- Migration 0059 — CLV throttle activates earlier
-- ============================================================================
--
-- Lowers `speed_clv_min_settled_trades` from 30 → 20.
--
-- Why: pre-launch hardening. With the agent network about to activate, the
-- CLV throttle (mig 0044) is our defense against sharp users grinding edge
-- against the model. At a 30-trade activation window a sophisticated user
-- can extract significant value in their first 29 trades before any shading
-- kicks in. Lowering to 20 catches sharks ~33% sooner without (per the
-- Jeffreys 95% CI gate) materially raising the false-positive rate against
-- variance-lucky novices.
--
-- The CI gate is still 0.02 (2pp lower bound) and the cap is still 8pp —
-- those are the real precision guards. Activation count is just "do we
-- have enough samples for the CI to mean anything yet?" 20 is conservative
-- and matches the Sprint 2 design doc's stated floor.
--
-- Effect window: next nightly recompute cron run (`_speed_recompute_edge_scores`).
-- Users currently shaded continue to be shaded; new shading evaluations
-- against users with 20–29 settled trades start firing tonight.
--
-- Rollback: same UPDATE with 30 in place of 20.

SET search_path = public;

UPDATE fee_config
   SET rate = 20,
       updated_at = NOW(),
       description = '0044 Sprint 2: minimum settled trades before shading kicks in. Below this, edge score is too noisy. (Lowered 30→20 in mig 0059 for earlier shark detection pre-launch.)'
 WHERE fee_type = 'speed_clv_min_settled_trades';

DO $$
DECLARE
  v_rate numeric;
BEGIN
  SELECT rate INTO v_rate FROM fee_config WHERE fee_type = 'speed_clv_min_settled_trades';
  IF v_rate <> 20 THEN
    RAISE EXCEPTION 'Mig 0059: expected speed_clv_min_settled_trades=20, got %', v_rate;
  END IF;
  RAISE NOTICE 'Mig 0059: speed_clv_min_settled_trades=% (was 30).', v_rate;
END $$;
