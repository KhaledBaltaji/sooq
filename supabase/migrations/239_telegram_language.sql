-- Migration 239: Add language preference to telegram_users + user-facing RLS
BEGIN;

-- 1. Language column (nullable = not yet chosen → bot shows picker)
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS language TEXT CHECK (language IN ('en', 'ar'));

-- 2. Users can read their own telegram_users record (Settings page needs this)
CREATE POLICY "Users read own telegram_users"
  ON telegram_users FOR SELECT
  USING (user_id = auth.uid());

-- 3. Users can delete their own record (unlink flow)
CREATE POLICY "Users delete own telegram_users"
  ON telegram_users FOR DELETE
  USING (user_id = auth.uid());

COMMIT;
