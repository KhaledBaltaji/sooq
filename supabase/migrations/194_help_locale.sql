-- Add locale column to help_collections for language filtering
ALTER TABLE help_collections ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';

-- Tag Arabic collections by slug convention
UPDATE help_collections SET locale = 'ar' WHERE slug LIKE '%-ar';

-- Index for efficient locale filtering
CREATE INDEX idx_help_collections_locale ON help_collections(locale, sort_order);
