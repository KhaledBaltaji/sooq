-- 0012_help_center.sql
--
-- Sooq help center — admin-editable knowledge base, public read.
-- Slim port from prediction-market migrations 122 (schema), 194 (locale).
-- W2 strip dropped these tables; bringing them back so admins can publish
-- FAQs without a deploy.
--
-- Differences vs prediction-market original:
--   * No RLS — Sooq enforces admin/public separation at the API layer
--     (requireAdminApi in /api/admin/* routes, public reads in /api/help/*).
--   * `locale` column kept; default 'en'. Bilingual landing post-W6.
--   * No FTS gin index — Sooq's help volume will be small (<100 articles
--     for v1) and search is client-side over the loaded list. Add one
--     later if the catalog grows.

BEGIN;

CREATE TABLE IF NOT EXISTS help_collections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  title         TEXT NOT NULL,
  description   TEXT,
  icon          TEXT NOT NULL DEFAULT 'help-circle',
  locale        TEXT NOT NULL DEFAULT 'en',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_published  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_collections_locale
  ON help_collections (locale, sort_order);

CREATE TABLE IF NOT EXISTS help_articles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  UUID NOT NULL REFERENCES help_collections(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_published   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (collection_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_help_articles_collection
  ON help_articles (collection_id, sort_order);

-- Auto-bump updated_at on UPDATE so admin UIs can sort by recency
-- without trusting clients to set it.
CREATE OR REPLACE FUNCTION help_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_help_collections_touch ON help_collections;
CREATE TRIGGER trg_help_collections_touch
  BEFORE UPDATE ON help_collections
  FOR EACH ROW EXECUTE FUNCTION help_touch_updated_at();

DROP TRIGGER IF EXISTS trg_help_articles_touch ON help_articles;
CREATE TRIGGER trg_help_articles_touch
  BEFORE UPDATE ON help_articles
  FOR EACH ROW EXECUTE FUNCTION help_touch_updated_at();

COMMIT;
