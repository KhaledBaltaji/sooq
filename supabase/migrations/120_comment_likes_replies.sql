BEGIN;

-- Add parent_id for threading and like_count cache
ALTER TABLE market_comments
  ADD COLUMN parent_id UUID REFERENCES market_comments(id) ON DELETE CASCADE,
  ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_market_comments_parent ON market_comments(parent_id);

-- Likes table (one like per user per comment)
CREATE TABLE comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES market_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);
CREATE INDEX idx_comment_likes_user ON comment_likes(user_id);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Anyone can read likes
CREATE POLICY "likes_select" ON comment_likes FOR SELECT USING (true);
-- Logged-in users can like
CREATE POLICY "likes_insert" ON comment_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Users can unlike their own
CREATE POLICY "likes_delete" ON comment_likes FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;
