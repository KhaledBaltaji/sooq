-- Add email column to prelaunch_waitlist, make phone optional
-- Email is now the primary identifier for waitlist signups

ALTER TABLE prelaunch_waitlist ADD COLUMN IF NOT EXISTS email TEXT;

-- Make phone nullable (was NOT NULL)
ALTER TABLE prelaunch_waitlist ALTER COLUMN phone DROP NOT NULL;

-- Add unique constraint on email
CREATE UNIQUE INDEX IF NOT EXISTS idx_prelaunch_waitlist_email ON prelaunch_waitlist (email) WHERE email IS NOT NULL;
