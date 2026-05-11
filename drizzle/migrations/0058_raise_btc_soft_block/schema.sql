-- ============================================================================
-- Migration 0058 — raise BTC soft-block threshold to match hard reject (0.97)
-- ============================================================================
--
-- Previously:
--   BTC-5m: soft_block_threshold = 0.95, unlock = 0.94
--   BTC-1m: soft_block_threshold = 0.85, unlock = 0.84
--
-- New:
--   Both: soft_block_threshold = 0.97, unlock = 0.96
--
-- Why: the server-side hard reject is `fair_prob > 0.97`. The 95% soft-block
-- was creating a 95-97 dead zone where trades got greyed with a misleading
-- "Market closing" message but the server would NOT have hard-rejected.
-- Combined with the casino-style product positioning this read as paternalism
-- ("you can only bet when the house wants you to"). Raising the threshold to
-- 0.97 aligns soft-block with the hard-reject ceiling: client-side button
-- greying mirrors what the server will actually refuse.
--
-- GOLD untouched — Sprint 4 mig 0048 chose 0.85 deliberately for the lower-vol
-- gold tape. Re-tune when gold launches.

SET search_path = public;

UPDATE speed_market_config
   SET soft_block_threshold = 0.97,
       soft_block_unlock    = 0.96,
       updated_at           = NOW()
 WHERE asset = 'BTC' AND duration IN ('1m'::speed_duration, '5m'::speed_duration);

DO $$
DECLARE
  v_btc_5m  RECORD;
  v_btc_1m  RECORD;
BEGIN
  SELECT soft_block_threshold, soft_block_unlock INTO v_btc_5m
  FROM speed_market_config WHERE asset = 'BTC' AND duration = '5m';

  SELECT soft_block_threshold, soft_block_unlock INTO v_btc_1m
  FROM speed_market_config WHERE asset = 'BTC' AND duration = '1m';

  RAISE NOTICE 'Mig 0058: BTC-5m soft_block=%/% , BTC-1m soft_block=%/%.',
    v_btc_5m.soft_block_threshold, v_btc_5m.soft_block_unlock,
    v_btc_1m.soft_block_threshold, v_btc_1m.soft_block_unlock;
END $$;
