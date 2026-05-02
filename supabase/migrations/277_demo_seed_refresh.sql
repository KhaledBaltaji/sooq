-- 277_demo_seed_refresh.sql — Demo Mode: refresh stale seed catalog
--
-- Migration 272 seeded 20 demo markets with `resolves_at = now() + N days`
-- when it ran in mid-April 2026. By now most of those dates have passed,
-- so demo users see a catalog of markets that should have resolved weeks ago.
--
-- This migration:
--   1. Deletes every market whose `keywords` contains a `demo.seed.*` element.
--      CASCADE handles demo_amm_state, demo_market_scheduled_outcomes,
--      demo_positions, demo_trades, demo_transactions.
--   2. Inserts 5 fresh political markets with fixed resolution dates at
--      end of 2026 and end of 2027 (time-invariant, won't stale).
--   3. Initializes AMM state, scheduled outcomes, and the sentinel initial-price
--      trade for each — mirroring the pattern in 272.
--
-- Demo trade history on the old seed markets will be lost. That's OK: demo
-- balance is fake money, not real funds. If a user had positions on the old
-- seeds, they're gone from demo_positions (cascade) and their trades from
-- demo_trades (cascade). The user's demo_balance_usd itself is NOT touched.
--
-- Idempotency: ON CONFLICT (question_en) DO NOTHING on the INSERT, and the
-- DELETE is a no-op if no demo.seed.* markets exist.

BEGIN;

-- ─── Step 1: Remove stale seed markets (cascades to child tables) ────────────
DELETE FROM demo_markets
WHERE EXISTS (
  SELECT 1 FROM unnest(keywords) AS k
  WHERE k LIKE 'demo.seed.%'
);

-- ─── Step 2: Seed 5 new political markets ────────────────────────────────────
DO $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL := 5000;
  v_yes DECIMAL;
  v_no DECIMAL;
  v_now TIMESTAMPTZ := NOW();
  r RECORD;
BEGIN
  -- Find the primary admin user (same pattern as migration 272).
  SELECT id INTO v_admin_id FROM users WHERE is_admin = TRUE ORDER BY created_at LIMIT 1;
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;
  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'No users found; skipping demo seed refresh.';
    RETURN;
  END IF;

  v_yes := lmsr_price(v_b, 0, 0, 'yes');
  v_no  := lmsr_price(v_b, 0, 0, 'no');

  FOR r IN
    SELECT * FROM (
      VALUES
        -- ─── End of 2026 ───
        ('Will Lebanon have a fully-empowered cabinet by Dec 31, 2026?',
         'هل سيكون للبنان حكومة مكتملة الصلاحيات بحلول 31 ديسمبر 2026؟',
         'politics', 'no',
         '2026-12-31 23:59:59+00'::TIMESTAMPTZ,
         'demo.seed.politics_lebanon_cabinet_2026'),
        ('Will the Palestinian Authority hold general elections before end of 2026?',
         'هل ستُجري السلطة الفلسطينية انتخابات عامة قبل نهاية 2026؟',
         'politics', 'no',
         '2026-12-31 23:59:59+00'::TIMESTAMPTZ,
         'demo.seed.politics_palestinian_elections_2026'),

        -- ─── End of 2027 ───
        ('Will Saudi Arabia and Israel formally normalize diplomatic relations by Dec 31, 2027?',
         'هل ستطبّع المملكة العربية السعودية علاقاتها الدبلوماسية رسمياً مع إسرائيل بحلول 31 ديسمبر 2027؟',
         'politics', 'yes',
         '2027-12-31 23:59:59+00'::TIMESTAMPTZ,
         'demo.seed.politics_saudi_israel_2027'),
        ('Will Iraq hold national parliamentary elections before end of 2027?',
         'هل ستُجري العراق انتخابات برلمانية وطنية قبل نهاية 2027؟',
         'politics', 'yes',
         '2027-12-31 23:59:59+00'::TIMESTAMPTZ,
         'demo.seed.politics_iraq_elections_2027'),
        ('Will the US and Iran sign a new nuclear agreement by Dec 31, 2027?',
         'هل ستوقّع الولايات المتحدة وإيران اتفاقية نووية جديدة بحلول 31 ديسمبر 2027؟',
         'politics', 'no',
         '2027-12-31 23:59:59+00'::TIMESTAMPTZ,
         'demo.seed.politics_us_iran_nuclear_2027')
    ) AS t (q_en, q_ar, category, scheduled_outcome, resolves_at, i18n_key)
  LOOP
    -- Effective resolution date: prefer the branded date (2026-12-31 / 2027-12-31)
    -- if still future, else fall back to NOW() + 90 days. Without this guard,
    -- replaying this migration after 2026-12-31 (fresh env, disaster recovery)
    -- would violate the demo_closes_after_opens CHECK (closes_at > opens_at)
    -- and abort the entire seed refresh.
    INSERT INTO demo_markets (
      question_en, question_ar,
      category, keywords, amm_liquidity_param,
      opens_at, closes_at, resolves_at,
      created_by, status, resolution_fee_rate_snapshot
    ) VALUES (
      r.q_en, r.q_ar,
      r.category, ARRAY[r.category, r.i18n_key], v_b,
      v_now,
      GREATEST(r.resolves_at, v_now + INTERVAL '90 days'),
      GREATEST(r.resolves_at, v_now + INTERVAL '90 days'),
      v_admin_id, 'open', 0
    )
    ON CONFLICT (question_en) DO NOTHING
    RETURNING id INTO v_market_id;

    IF v_market_id IS NOT NULL THEN
      INSERT INTO demo_market_scheduled_outcomes (market_id, scheduled_outcome, created_by)
      VALUES (v_market_id, r.scheduled_outcome::bet_side, v_admin_id)
      ON CONFLICT (market_id) DO NOTHING;

      INSERT INTO demo_amm_state (
        market_id, liquidity_param, q_yes, q_no,
        current_yes_price, current_no_price
      ) VALUES (
        v_market_id, v_b, 0, 0, v_yes, v_no
      )
      ON CONFLICT (market_id) DO NOTHING;

      -- Synthetic initial-price trade so price history / charts have a starting point.
      INSERT INTO demo_trades (
        user_id, market_id, side, direction, shares,
        price_per_share, total_cost, post_yes_price, post_no_price,
        created_at
      ) VALUES (
        v_admin_id, v_market_id, 'yes'::bet_side, 'buy'::trade_direction,
        0.000001, 0.500000, 0.00, 0.500000, 0.500000, v_now
      );
    END IF;

    v_market_id := NULL;
  END LOOP;
END $$;

COMMIT;
