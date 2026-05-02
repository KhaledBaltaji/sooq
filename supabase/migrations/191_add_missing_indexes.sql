-- 191_add_missing_indexes.sql — Performance indexes for commission and comment queries

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer_status ON referral_commissions (referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_market_status ON referral_commissions (market_id, status);
CREATE INDEX IF NOT EXISTS idx_market_comments_market_id ON market_comments (market_id, created_at DESC);
