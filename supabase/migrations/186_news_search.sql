-- Migration 186: Add full-text search for matching news articles to markets
-- Enables market cards to show up to 3 related articles per market

-- GIN index for fast full-text search on news articles
CREATE INDEX IF NOT EXISTS idx_news_articles_fts
ON news_articles USING gin(to_tsvector('english', title || ' ' || COALESCE(summary, '')));

-- RPC: find news articles related to a market by direct match + text search
CREATE OR REPLACE FUNCTION search_news_for_market(
  p_question text,
  p_market_id uuid,
  p_limit int DEFAULT 3
)
RETURNS TABLE(id uuid, title text, source_name text, published_at timestamptz) AS $$
DECLARE
  v_direct_count int;
BEGIN
  -- First: return direct market_id matches
  RETURN QUERY
    SELECT n.id, n.title, n.source_name, n.published_at
    FROM news_articles n
    WHERE n.market_id = p_market_id
    ORDER BY n.published_at DESC
    LIMIT p_limit;

  GET DIAGNOSTICS v_direct_count = ROW_COUNT;

  -- If we already have enough, stop
  IF v_direct_count >= p_limit THEN
    RETURN;
  END IF;

  -- Second: fill remaining slots with text-search matches
  RETURN QUERY
    SELECT n.id, n.title, n.source_name, n.published_at
    FROM news_articles n
    WHERE n.market_id IS DISTINCT FROM p_market_id
      AND to_tsvector('english', n.title || ' ' || COALESCE(n.summary, ''))
          @@ plainto_tsquery('english', p_question)
    ORDER BY n.published_at DESC
    LIMIT (p_limit - v_direct_count);

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
