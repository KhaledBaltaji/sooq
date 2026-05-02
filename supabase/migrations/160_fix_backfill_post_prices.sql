-- 160_fix_backfill_post_prices.sql — Re-run backfill with explicit enum→text casts

BEGIN;

-- Reset all post prices to re-compute
UPDATE trades SET post_yes_price = NULL, post_no_price = NULL;

-- Re-run backfill with explicit type casting for enum comparisons
DO $$
DECLARE
  v_market RECORD;
  v_trade RECORD;
  v_q_yes DECIMAL := 0;
  v_q_no DECIMAL := 0;
  v_b DECIMAL;
  v_computed_yes DECIMAL;
  v_computed_no DECIMAL;
  v_trade_count INT := 0;
BEGIN
  FOR v_market IN
    SELECT DISTINCT t.market_id, a.liquidity_param
    FROM trades t
    JOIN amm_state a ON a.market_id = t.market_id
    WHERE t.post_yes_price IS NULL
  LOOP
    v_b := v_market.liquidity_param;
    v_q_yes := 0;
    v_q_no := 0;
    v_trade_count := 0;

    FOR v_trade IN
      SELECT id, side::text AS side, direction::text AS direction, shares
      FROM trades
      WHERE market_id = v_market.market_id
      ORDER BY created_at ASC
    LOOP
      v_trade_count := v_trade_count + 1;

      -- Accumulate q values based on trade direction and side
      IF v_trade.direction = 'buy' AND v_trade.side = 'yes' THEN
        v_q_yes := v_q_yes + v_trade.shares;
      ELSIF v_trade.direction = 'sell' AND v_trade.side = 'yes' THEN
        v_q_yes := v_q_yes - v_trade.shares;
      ELSIF v_trade.direction = 'buy' AND v_trade.side = 'no' THEN
        v_q_no := v_q_no + v_trade.shares;
      ELSIF v_trade.direction = 'sell' AND v_trade.side = 'no' THEN
        v_q_no := v_q_no - v_trade.shares;
      END IF;

      v_computed_yes := lmsr_price(v_b, v_q_yes, v_q_no, 'yes');
      v_computed_no := lmsr_price(v_b, v_q_yes, v_q_no, 'no');

      UPDATE trades SET
        post_yes_price = v_computed_yes,
        post_no_price = v_computed_no
      WHERE id = v_trade.id;
    END LOOP;

    RAISE NOTICE 'Market %: % trades, final q_yes=%, q_no=%, yes_price=%',
      v_market.market_id, v_trade_count,
      ROUND(v_q_yes, 2), ROUND(v_q_no, 2),
      ROUND(lmsr_price(v_b, v_q_yes, v_q_no, 'yes'), 4);
  END LOOP;
END;
$$;

COMMIT;
