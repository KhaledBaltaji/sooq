-- 181_add_geo_fields.sql — Add IP, region, country_code to user_locations for Vercel geo tracking

BEGIN;

ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS country_code TEXT;

-- Index on country_code for marketing analytics queries
CREATE INDEX IF NOT EXISTS idx_user_locations_country_code ON user_locations(country_code);

-- Allow service_role to upsert (API route uses server client)
CREATE POLICY "Service role can manage all locations"
  ON user_locations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
