-- 040_rls_policies.sql — Row Level Security for all tables

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- USERS: Read own profile, read others' public fields
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can read public profiles"
  ON users FOR SELECT USING (TRUE);  -- public fields filtered by select

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id)
  -- Restrict to safe columns only (display_name, avatar_url, phone)
  -- Sensitive columns protected by trigger in 041_protect_sensitive_columns.sql
;

-- MARKETS: Everyone can read, only admins can insert/update
CREATE POLICY "Anyone can read markets"
  ON markets FOR SELECT USING (TRUE);

CREATE POLICY "Admins can insert markets"
  ON markets FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can update markets"
  ON markets FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- BETS: Read own bets, read all bets for market activity feed
CREATE POLICY "Users can read own bets"
  ON bets FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can read bets for activity"
  ON bets FOR SELECT USING (TRUE);

-- Bets are inserted via place_bet RPC (SECURITY DEFINER), not directly
CREATE POLICY "No direct bet inserts"
  ON bets FOR INSERT WITH CHECK (FALSE);

-- TRANSACTIONS: Users can only read own
CREATE POLICY "Users can read own transactions"
  ON transactions FOR SELECT USING (auth.uid() = user_id);

-- No direct inserts — all via RPCs
CREATE POLICY "No direct transaction inserts"
  ON transactions FOR INSERT WITH CHECK (FALSE);

-- DEPOSITS: Users can read own
CREATE POLICY "Users can read own deposits"
  ON deposits FOR SELECT USING (auth.uid() = user_id);

-- WITHDRAWALS: Users can read own
CREATE POLICY "Users can read own withdrawals"
  ON withdrawals FOR SELECT USING (auth.uid() = user_id);

-- REFERRAL_COMMISSIONS: Users can read where they are referrer
CREATE POLICY "Referrers can read own commissions"
  ON referral_commissions FOR SELECT USING (auth.uid() = referrer_id);

-- PLATFORM_REVENUE: Admin only
CREATE POLICY "Admins can read revenue"
  ON platform_revenue FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- FEE_CONFIG: Everyone can read (rates are public)
CREATE POLICY "Anyone can read fee config"
  ON fee_config FOR SELECT USING (TRUE);

CREATE POLICY "Admins can update fee config"
  ON fee_config FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- NOTIFICATIONS: Users can read own
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ADMIN: Read access to all user data for admin dashboard
CREATE POLICY "Admins can read all transactions"
  ON transactions FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all bets"
  ON bets FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all deposits"
  ON deposits FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all withdrawals"
  ON withdrawals FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all commissions"
  ON referral_commissions FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins can read all notifications"
  ON notifications FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );
