-- 272_demo_seed.sql — Demo Mode: seed 20 bilingual demo markets
--
-- Staggered resolution schedule:
--   3 markets resolve tomorrow (+1 day)
--   9 markets resolve next week (+7 days)
--   4 markets resolve +14 days
--   4 markets resolve next month (+30 days)
--
-- Theme mix: sports (5), politics (5), weather/fun (5), economy (5)
--
-- Idempotency: ON CONFLICT DO NOTHING on question_en unique natural key.
-- Future seed migrations can re-use the same question_en keys safely.
--
-- Direct SQL inserts rather than RPC calls because the admin_create_demo_market
-- RPC requires auth.uid() = admin, which migrations don't provide. We use the
-- platform's primary admin user id directly.

BEGIN;

-- Ensure question_en is unique for idempotency (safe to re-run this migration).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'demo_markets'
      AND indexname = 'demo_markets_question_en_unique'
  ) THEN
    CREATE UNIQUE INDEX demo_markets_question_en_unique ON demo_markets(question_en);
  END IF;
END $$;

-- Seed helper: inline inserts inside a DO block so we can loop and share
-- the admin_id lookup. Each market gets: demo_markets row + schedule row +
-- demo_amm_state row + demo_seed_initial_price (synthetic trade at 50%).

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
  -- Find any admin user; fall back to an arbitrary user if no admin exists
  -- (shouldn't happen on a properly seeded DB but keeps the migration safe).
  SELECT id INTO v_admin_id FROM users WHERE is_admin = TRUE ORDER BY created_at LIMIT 1;
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;
  IF v_admin_id IS NULL THEN
    -- No users at all — bail silently. Seed can run later once a user exists.
    RAISE NOTICE 'No users found; skipping demo seed catalog.';
    RETURN;
  END IF;

  v_yes := lmsr_price(v_b, 0, 0, 'yes');
  v_no  := lmsr_price(v_b, 0, 0, 'no');

  FOR r IN
    SELECT * FROM (
      VALUES
        -- ─── Sports (5) ───
        ('Will Lebanon beat Syria in the next football friendly?',
         'هل سيفوز لبنان على سوريا في المباراة الودية القادمة؟',
         'sports', 'yes',  7, 'demo.seed.sports_lebanon_syria'),
        ('Will the Premier League top scorer reach 30 goals this season?',
         'هل سيصل هداف الدوري الإنجليزي إلى ٣٠ هدفاً هذا الموسم؟',
         'sports', 'no',  30, 'demo.seed.sports_epl_top_scorer'),
        ('Will Real Madrid qualify from the Champions League group stage?',
         'هل سيتأهل ريال مدريد من مرحلة مجموعات دوري أبطال أوروبا؟',
         'sports', 'yes', 14, 'demo.seed.sports_real_madrid_cl'),
        ('Will a Saudi club reach the AFC Champions League final?',
         'هل سيصل نادٍ سعودي إلى نهائي دوري أبطال آسيا؟',
         'sports', 'yes', 30, 'demo.seed.sports_saudi_afc'),
        ('Will the UFC heavyweight champion defend his title next fight?',
         'هل سيحتفظ بطل الوزن الثقيل في UFC بلقبه في نزاله القادم؟',
         'sports', 'no',  7,  'demo.seed.sports_ufc_heavyweight'),

        -- ─── Politics (5) ───
        ('Will Lebanon elect a new president within 30 days?',
         'هل ستنتخب لبنان رئيساً جديداً خلال ٣٠ يوماً؟',
         'politics', 'no', 30, 'demo.seed.politics_lebanon_president'),
        ('Will the US Congress pass a new budget this week?',
         'هل سيقر الكونغرس الأمريكي ميزانية جديدة هذا الأسبوع؟',
         'politics', 'no',  7, 'demo.seed.politics_us_budget'),
        ('Will Saudi Arabia announce a new economic reform package this week?',
         'هل ستعلن المملكة العربية السعودية عن حزمة إصلاحات اقتصادية هذا الأسبوع؟',
         'politics', 'yes', 7, 'demo.seed.politics_ksa_reform'),
        ('Will an Arab League summit be convened this month?',
         'هل ستُعقد قمة عربية هذا الشهر؟',
         'politics', 'yes', 14, 'demo.seed.politics_arab_league'),
        ('Will the UN Security Council pass a new Middle East resolution tomorrow?',
         'هل سيصدر مجلس الأمن قراراً جديداً بشأن الشرق الأوسط غداً؟',
         'politics', 'no',  1, 'demo.seed.politics_un_resolution'),

        -- ─── Weather / Fun (5) ───
        ('Will Beirut see rain tomorrow?',
         'هل ستهطل الأمطار في بيروت غداً؟',
         'weather', 'no',  1, 'demo.seed.weather_beirut_rain'),
        ('Will Dubai hit 40°C this week?',
         'هل ستصل حرارة دبي إلى ٤٠ درجة مئوية هذا الأسبوع؟',
         'weather', 'yes', 7, 'demo.seed.weather_dubai_40'),
        ('Will a Middle East country host a FIFA World Cup bid announcement this month?',
         'هل ستعلن دولة شرق أوسطية عن ترشح لاستضافة كأس العالم هذا الشهر؟',
         'weather', 'no', 30, 'demo.seed.fun_me_fifa_bid'),
        ('Will snowfall occur in the Lebanese mountains tomorrow?',
         'هل ستشهد الجبال اللبنانية تساقطاً للثلوج غداً؟',
         'weather', 'no',  1, 'demo.seed.weather_lebanon_snow'),
        ('Will the average Riyadh temperature exceed 30°C next week?',
         'هل سيتجاوز متوسط درجة حرارة الرياض ٣٠ درجة الأسبوع المقبل؟',
         'weather', 'yes', 7, 'demo.seed.weather_riyadh_30'),

        -- ─── Economy / Long-tail (5) ───
        ('Will the USD/LBP exchange rate stay under 95,000 for the next 7 days?',
         'هل سيبقى سعر صرف الدولار/الليرة اللبنانية تحت ٩٥٫٠٠٠ خلال الأيام السبعة القادمة؟',
         'economy', 'yes', 7,  'demo.seed.econ_usd_lbp'),
        ('Will Brent crude close above $85 next week?',
         'هل سيُغلق خام برنت فوق ٨٥ دولاراً الأسبوع المقبل؟',
         'economy', 'yes', 7,  'demo.seed.econ_brent_85'),
        ('Will Bitcoin exceed $80,000 within 14 days?',
         'هل سيتجاوز البيتكوين ٨٠٫٠٠٠ دولار خلال ١٤ يوماً؟',
         'economy', 'no', 14, 'demo.seed.econ_btc_80k'),
        ('Will gold close below $2,400/oz this month?',
         'هل سيغلق الذهب تحت ٢٤٠٠ دولار للأونصة هذا الشهر؟',
         'economy', 'no', 30, 'demo.seed.econ_gold_2400'),
        ('Will a MENA fintech announce a $100M+ Series B this month?',
         'هل ستعلن شركة تكنولوجيا مالية في منطقة الشرق الأوسط عن جولة تمويل ب بأكثر من ١٠٠ مليون دولار هذا الشهر؟',
         'economy', 'yes', 30, 'demo.seed.econ_mena_fintech_b')
    ) AS t (q_en, q_ar, category, scheduled_outcome, resolves_in_days, i18n_key)
  LOOP
    -- Insert market; skip if question_en already exists
    INSERT INTO demo_markets (
      question_en, question_ar,
      category, keywords, amm_liquidity_param,
      opens_at, closes_at, resolves_at,
      created_by, status, resolution_fee_rate_snapshot
    ) VALUES (
      r.q_en, r.q_ar,
      r.category, ARRAY[r.category, r.i18n_key], v_b,
      v_now,
      v_now + (r.resolves_in_days || ' days')::INTERVAL,
      v_now + (r.resolves_in_days || ' days')::INTERVAL,
      v_admin_id, 'open', 0
    )
    ON CONFLICT (question_en) DO NOTHING
    RETURNING id INTO v_market_id;

    -- If the row was created fresh, initialize AMM + schedule + initial price
    IF v_market_id IS NOT NULL THEN
      INSERT INTO demo_market_scheduled_outcomes (market_id, scheduled_outcome, created_by)
      VALUES (v_market_id, r.scheduled_outcome::bet_side, v_admin_id)
      ON CONFLICT (market_id) DO NOTHING;

      INSERT INTO demo_amm_state (market_id, liquidity_param, q_yes, q_no,
                                  current_yes_price, current_no_price)
      VALUES (v_market_id, v_b, 0, 0, v_yes, v_no)
      ON CONFLICT (market_id) DO NOTHING;

      -- Synthetic initial-price trade (so charts are non-blank)
      INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                               price_per_share, total_cost, post_yes_price, post_no_price,
                               created_at)
      VALUES (v_admin_id, v_market_id, 'yes'::bet_side, 'buy'::trade_direction,
              0.000001, 0.500000, 0.00, 0.500000, 0.500000, v_now);
    END IF;

    v_market_id := NULL;  -- reset for next iteration
  END LOOP;
END $$;

COMMIT;
