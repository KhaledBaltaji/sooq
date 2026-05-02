-- News articles table for live feed sidebar
-- Populated by Vercel cron every 10 minutes via RSS feeds

CREATE TABLE news_articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,  -- dedup key
  source_name TEXT NOT NULL,
  source_tier TEXT NOT NULL DEFAULT 'Major Outlet',  -- Official, Major Outlet, Local Source, Aggregator
  summary TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  category TEXT,  -- matched market category (nullable)
  market_id UUID REFERENCES markets(id) ON DELETE SET NULL,  -- nullable, set if matched to a market
  image_url TEXT  -- og:image if available from RSS
);

CREATE INDEX idx_news_articles_published ON news_articles (published_at DESC);
CREATE INDEX idx_news_articles_market ON news_articles (market_id);

-- RLS: news_articles are public read, only service role writes
ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read news articles"
  ON news_articles FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated — only service role key writes
