-- ============================================================================
-- Migration 0044 — Sprint 2 — Per-user CLV throttle
-- ============================================================================
--
-- Surgical anti-shark layer. For each settled user trade, compute the
-- realized edge over their offered price: e_i = actual_outcome - offered_prob
-- (actual=1 for wins, 0 for losses). Mean over the user's last N settled
-- trades is their edge_score. Users with reliably positive edge get their
-- offered_prob shaded UP at trade-open, reducing their payout per win.
--
-- Self-stabilizing feedback: as shading kicks in, future settled trades
-- are at higher offered prices, so future edge_score shrinks naturally.
--
-- Founder decisions (Phase 4 plan, locked):
--   - Anti-multi-account: SKIPPED. Documented leak (sharks can reset by
--     creating new accounts; KYC friction is the only mitigation).
--   - CLV cashout coupling: Option A — shade entry only, store shaded
--     value on speed_positions.entry_offered_prob (no schema change).
--     Cashout uses unshaded mark + stored shaded entry. Direction-matching
--     invariant arithmetic stays clean.
--   - Cap: shading capped at +0.08 (8pp) regardless of edge size, AND
--     never pushes above soft_block_threshold - epsilon (so shaded users
--     don't hit SOFT_BLOCK from the shading itself).
--
-- Gate (when shading fires):
--   - settled_trades >= 30 (statistical noise floor)
--   - ci_low > 0.02 (2pp lower bound on edge using one-tailed test;
--     point estimate of edge_score must be reliable, not variance-lucky)
--   - manual_override_until is NULL or in past (admin override wins
--     when present)
--
-- Modeled effect on Rami (validated against his actual 14d trades):
--   - Today: $246/day
--   - With +8pp shading at the cap: ~$108/day (-56%)
--
-- All flag-gated. Default OFF. Admin enables via fee_config flag once
-- staging soak time confirms behavior.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) speed_user_edge_scores — per-user edge score + CI + manual override
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.speed_user_edge_scores (
  user_id                 UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  settled_trades          INT NOT NULL DEFAULT 0 CHECK (settled_trades >= 0),
  wins                    INT NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses                  INT NOT NULL DEFAULT 0 CHECK (losses >= 0),
  avg_offered             NUMERIC NOT NULL DEFAULT 0 CHECK (avg_offered >= 0 AND avg_offered <= 1),
  win_rate                NUMERIC NOT NULL DEFAULT 0 CHECK (win_rate >= 0 AND win_rate <= 1),
  edge_score              NUMERIC NOT NULL DEFAULT 0 CHECK (edge_score >= -1 AND edge_score <= 1),
  edge_se                 NUMERIC NOT NULL DEFAULT 0 CHECK (edge_se >= 0),
  ci_low                  NUMERIC NOT NULL DEFAULT 0 CHECK (ci_low >= -1 AND ci_low <= 1),
  ci_high                 NUMERIC NOT NULL DEFAULT 0 CHECK (ci_high >= -1 AND ci_high <= 1),

  -- Manual admin override; when set + not expired, replaces the computed
  -- shading factor. Null/past = use computed.
  manual_shading_factor   NUMERIC CHECK (manual_shading_factor IS NULL OR (manual_shading_factor >= 0 AND manual_shading_factor <= 0.20)),
  manual_override_until   TIMESTAMPTZ,
  manual_override_reason  TEXT,

  last_recomputed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT speed_user_edge_scores_wins_lte_settled
    CHECK (wins + losses <= settled_trades + losses + wins) -- structurally allows wins+losses == settled
);

COMMENT ON TABLE public.speed_user_edge_scores IS
  '0044 Sprint 2: per-user edge score over last N settled trades. Cron _speed_recompute_edge_scores updates nightly. Helper _speed_apply_user_shading reads to shade a sharp user offered_prob UP at trade-open (entry only).';

CREATE INDEX IF NOT EXISTS speed_user_edge_scores_top_idx
  ON public.speed_user_edge_scores (edge_score DESC, settled_trades DESC)
  WHERE settled_trades >= 30;

CREATE INDEX IF NOT EXISTS speed_user_edge_scores_stale_idx
  ON public.speed_user_edge_scores (last_recomputed_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) fee_config flags + tunables (all default OFF)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_clv_throttle_enabled', 0,
   '0044 Sprint 2: master flag for per-user CLV throttle. 0 = off (no shading); 1 = on (shading applies to +edge users).'),
  ('speed_clv_min_settled_trades', 30,
   '0044 Sprint 2: minimum settled trades before shading kicks in. Below this, edge score is too noisy.'),
  ('speed_clv_min_ci_low', 0.02,
   '0044 Sprint 2: minimum lower-bound on 95% CI of edge_score for shading to fire. 0.02 = 2pp; balances "catch real sharks" with "do not punish variance-lucky".'),
  ('speed_clv_max_shading_pp', 0.08,
   '0044 Sprint 2: max shading in absolute probability points. 0.08 = 8pp cap regardless of how big the edge is.'),
  ('speed_clv_shading_factor', 0.7,
   '0044 Sprint 2: fraction of edge_score applied as shading. 0.7 = shade by 70% of measured edge (capped at max_shading_pp).'),
  ('speed_clv_window_n', 100,
   '0044 Sprint 2: number of last settled trades to compute edge score over.'),
  ('speed_clv_health_max_age_h', 36,
   '0044 Sprint 2: max age (hours) of last_recomputed_at before health check flags as stale.')
ON CONFLICT (fee_type) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) pg_cron schedule: nightly recompute at 04:00 UTC (offset from 03:00 matrix)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('speed_recompute_edge_scores')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'speed_recompute_edge_scores');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'speed_recompute_edge_scores',
      '0 4 * * *',
      $cron$SELECT public._speed_recompute_edge_scores();$cron$
    );
    RAISE NOTICE 'Scheduled speed_recompute_edge_scores at 04:00 UTC daily';
  ELSE
    RAISE NOTICE 'pg_cron not installed; CLV cron NOT scheduled. Install via CREATE EXTENSION pg_cron then re-run schedule manually.';
  END IF;
END $$;
