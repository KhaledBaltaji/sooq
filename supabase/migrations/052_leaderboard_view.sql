-- 052_leaderboard_view.sql — Materialized view for leaderboard stats
-- Excludes both-side markets from accuracy calculation

CREATE MATERIALIZED VIEW leaderboard_stats AS
WITH user_market_bets AS (
  -- Aggregate each user's bets per market
  SELECT
    b.user_id,
    b.market_id,
    m.outcome,
    m.status,
    SUM(CASE WHEN b.side = 'yes' THEN b.amount ELSE 0 END) AS yes_total,
    SUM(CASE WHEN b.side = 'no' THEN b.amount ELSE 0 END) AS no_total,
    COUNT(DISTINCT b.side) AS sides_bet
  FROM bets b
  JOIN markets m ON m.id = b.market_id
  WHERE m.status = 'resolved'
  GROUP BY b.user_id, b.market_id, m.outcome, m.status
),
user_stats AS (
  SELECT
    user_id,
    -- Total markets participated (resolved only)
    COUNT(*) AS markets_played,
    -- Accuracy: excludes both-side markets
    COUNT(*) FILTER (
      WHERE sides_bet = 1
        AND outcome IS NOT NULL
        AND (
          (outcome = 'yes' AND yes_total > 0 AND no_total = 0) OR
          (outcome = 'no' AND no_total > 0 AND yes_total = 0)
        )
    ) AS correct_predictions,
    COUNT(*) FILTER (WHERE sides_bet = 1) AS single_side_markets
  FROM user_market_bets
  GROUP BY user_id
)
SELECT
  us.user_id,
  u.display_name,
  us.markets_played,
  us.correct_predictions,
  us.single_side_markets,
  CASE WHEN us.single_side_markets > 0
    THEN ROUND(us.correct_predictions::DECIMAL / us.single_side_markets * 100, 1)
    ELSE 0
  END AS accuracy_pct,
  -- Profit from wins - bets (from transactions)
  COALESCE(
    (SELECT SUM(amount) FROM transactions WHERE user_id = us.user_id AND type IN ('win', 'bet')),
    0
  ) AS net_profit
FROM user_stats us
JOIN users u ON u.id = us.user_id;

CREATE UNIQUE INDEX idx_leaderboard_user ON leaderboard_stats(user_id);

-- Refresh function (called by trigger on resolve_market)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_stats;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on market resolution
CREATE TRIGGER trg_refresh_leaderboard
  AFTER UPDATE OF status ON markets
  FOR EACH ROW
  WHEN (NEW.status = 'resolved')
  EXECUTE FUNCTION refresh_leaderboard();
