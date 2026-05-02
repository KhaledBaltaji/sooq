BEGIN;

CREATE TABLE market_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_comments_market ON market_comments(market_id, created_at DESC);
CREATE INDEX idx_market_comments_user ON market_comments(user_id);

ALTER TABLE market_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read comments
CREATE POLICY "comments_select" ON market_comments FOR SELECT USING (true);
-- Logged-in users can insert their own
CREATE POLICY "comments_insert" ON market_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Users can delete their own
CREATE POLICY "comments_delete" ON market_comments FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;
