-- AI-powered support + Telegram bot integration
BEGIN;

-- 1. AI control columns on support_tickets
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS needs_human BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;

-- 2. Expand channel constraint to include telegram
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_channel_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_channel_check
  CHECK (channel IN ('web', 'telegram'));

-- 3. Add 'ai' role to support_messages
ALTER TABLE support_messages DROP CONSTRAINT IF EXISTS support_messages_role_check;
ALTER TABLE support_messages ADD CONSTRAINT support_messages_role_check
  CHECK (role IN ('user', 'admin', 'system', 'ai'));

-- 4. OTP verification codes for in-chat identity verification
CREATE TABLE IF NOT EXISTS support_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_verification_ticket
  ON support_verification_codes(ticket_id, created_at DESC);

-- 5. Telegram user linking
CREATE TABLE IF NOT EXISTS telegram_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  link_code TEXT UNIQUE,
  link_code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_user ON telegram_users(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_link_code
  ON telegram_users(link_code) WHERE link_code IS NOT NULL;

-- 6. RLS
ALTER TABLE support_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;

-- Service role handles all verification code access (no user policies needed)
-- Admin can read telegram_users for the admin panel
CREATE POLICY "Admin reads telegram_users"
  ON telegram_users FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

COMMIT;
