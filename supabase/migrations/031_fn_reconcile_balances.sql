-- 031_fn_reconcile_balances.sql — Compare balance_usd cache vs SUM(transactions)

CREATE OR REPLACE FUNCTION reconcile_balances()
RETURNS TABLE(
  user_id UUID,
  cached_balance DECIMAL,
  ledger_balance DECIMAL,
  difference DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.balance_usd AS cached_balance,
    COALESCE(SUM(t.amount), 0) AS ledger_balance,
    u.balance_usd - COALESCE(SUM(t.amount), 0) AS difference
  FROM users u
  LEFT JOIN transactions t ON t.user_id = u.id
  GROUP BY u.id, u.balance_usd
  HAVING ABS(u.balance_usd - COALESCE(SUM(t.amount), 0)) > 0.001;
END;
$$;
