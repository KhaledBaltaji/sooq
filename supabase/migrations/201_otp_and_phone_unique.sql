-- 201: OTP verifications table + phone uniqueness constraint
-- Supports WhatsApp OTP via VerifyWay (we generate + verify codes ourselves)

BEGIN;

-- OTP verification storage
CREATE TABLE otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  message_id TEXT,          -- VerifyWay message_id for delivery tracking
  ip TEXT,                  -- Client IP for rate limiting
  attempts INTEGER NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_phone_expires ON otp_verifications(phone, expires_at);

-- RLS enabled — only accessed via service role client in API routes
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON otp_verifications
  FOR ALL USING (auth.role() = 'service_role');

-- Phone uniqueness on users table (was indexed but not unique)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
  END IF;
END $$;

COMMIT;
