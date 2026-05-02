-- ============================================================
-- 174: Backfill correct balance_after on historical transactions
--
-- Bug: execute_trade (before migration 173) recorded
-- v_user.balance_usd (pre-trade snapshot) as balance_after
-- instead of the post-trade balance. This made the P&L chart
-- show incorrect values.
--
-- Fix: Reconstruct the correct balance_after for every
-- transaction using a running sum from each user's known
-- initial balance (derived from current balance - sum of all
-- transaction amounts).
-- ============================================================

WITH user_initial AS (
  SELECT u.id AS user_id,
         u.balance_usd - COALESCE(SUM(t.amount), 0) AS initial_balance
  FROM users u
  LEFT JOIN transactions t ON t.user_id = u.id
  GROUP BY u.id, u.balance_usd
),
running AS (
  SELECT t.id,
         ui.initial_balance + SUM(t.amount) OVER (
           PARTITION BY t.user_id
           ORDER BY t.created_at, t.id
         ) AS correct_balance_after
  FROM transactions t
  JOIN user_initial ui ON ui.user_id = t.user_id
)
UPDATE transactions
SET balance_after = running.correct_balance_after
FROM running
WHERE transactions.id = running.id
  AND transactions.balance_after IS DISTINCT FROM running.correct_balance_after;
