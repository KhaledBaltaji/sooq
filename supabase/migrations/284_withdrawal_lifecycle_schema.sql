-- 284_withdrawal_lifecycle_schema.sql
-- Fixes 3 P0 bugs found in withdrawal audit (2026-04-22):
--
-- 1. withdrawal_status enum had only 3 values (pending, approved, rejected).
--    Approved withdrawals had no terminal state — admin could approve but
--    never record that the money was actually sent. Funds held indefinitely.
--
-- 2. Withdrawals had a single `destination TEXT` column that the UI was
--    submitting the type-string ("whish" | "bank" | "crypto") into, not the
--    actual address/phone/IBAN. Admin had no way to know where to send money.
--
-- 3. No provider/network columns — admin couldn't filter queue by payment
--    rail (whish_manual vs 3pay crypto vs bank), and crypto withdrawals had
--    no way to distinguish TRC20 from ERC20.
--
-- This migration is pure schema. RPCs that produce/consume these columns
-- are updated in 285.

BEGIN;

-- ═══ 1. Expand withdrawal_status enum ═══
-- ALTER TYPE ADD VALUE cannot run inside a transaction, so we do the
-- drop+recreate dance via TEXT. Safe because:
--   - No RLS policies reference specific enum values (grepped all migrations)
--   - Existing rows only contain old values (pending/approved/rejected)
--   - Cast through TEXT preserves all data
ALTER TABLE withdrawals ALTER COLUMN status DROP DEFAULT;
ALTER TABLE withdrawals ALTER COLUMN status TYPE TEXT;
DROP TYPE withdrawal_status;
CREATE TYPE withdrawal_status AS ENUM (
  'pending',     -- user submitted, funds held
  'approved',    -- admin approved, money not yet sent externally
  'rejected',    -- admin rejected, funds refunded (terminal)
  'sent',        -- admin marked money sent externally with reference_id
  'completed',   -- external confirmation received (e.g. blockchain confirmed, whish receipt verified) (terminal)
  'failed'       -- send attempt failed — ops manual intervention required
);
ALTER TABLE withdrawals ALTER COLUMN status TYPE withdrawal_status USING status::withdrawal_status;
ALTER TABLE withdrawals ALTER COLUMN status SET DEFAULT 'pending';

-- ═══ 2. Add destination structure + send-tracking columns ═══
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS destination_type TEXT,  -- 'crypto' | 'whish' | 'bank'
  ADD COLUMN IF NOT EXISTS network TEXT,            -- 'TRC20' | 'ERC20' for crypto, NULL otherwise
  ADD COLUMN IF NOT EXISTS provider TEXT,           -- '3pay' | 'whish_manual' | 'bank_manual'
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS external_reference_id TEXT;

-- ═══ 3. Backfill existing rows ═══
-- Legacy rows have the type-string stored in `destination`. Move it to
-- `destination_type`, set `destination` to empty (no actual destination was
-- ever captured for these — they're unprocessable anyway), assign provider.
UPDATE withdrawals
SET destination_type = destination,
    provider = CASE
      WHEN destination = 'whish'  THEN 'whish_manual'
      WHEN destination = 'crypto' THEN '3pay'
      WHEN destination = 'bank'   THEN 'bank_manual'
      ELSE 'unknown'
    END,
    destination = ''
WHERE destination IN ('bank', 'crypto', 'whish')
  AND destination_type IS NULL;  -- idempotency: skip if already backfilled

-- ═══ 4. Indexes for admin queue filtering + lookups ═══
CREATE INDEX IF NOT EXISTS idx_withdrawals_provider ON withdrawals(provider);
CREATE INDEX IF NOT EXISTS idx_withdrawals_destination_type ON withdrawals(destination_type);
CREATE INDEX IF NOT EXISTS idx_withdrawals_external_reference_id ON withdrawals(external_reference_id)
  WHERE external_reference_id IS NOT NULL;

-- ═══ 5. Comments for future-me ═══
COMMENT ON COLUMN withdrawals.destination IS
  'Actual destination — wallet address (crypto), phone number (whish), or IBAN/account (bank). Validated in process_withdrawal RPC per destination_type.';
COMMENT ON COLUMN withdrawals.destination_type IS
  'Payment rail type: crypto | whish | bank. Determines destination format + which provider handles the outbound.';
COMMENT ON COLUMN withdrawals.network IS
  'Crypto network — TRC20 or ERC20. NULL for non-crypto rails. Required when destination_type = crypto.';
COMMENT ON COLUMN withdrawals.provider IS
  'Payment provider: 3pay (crypto automated), whish_manual (Lebanese mobile, manual send), bank_manual (wire, manual send).';
COMMENT ON COLUMN withdrawals.external_reference_id IS
  'Receipt from the external payment rail — blockchain tx hash for 3pay, whish transaction id, or bank wire reference. Recorded by admin_mark_withdrawal_sent.';
COMMENT ON COLUMN withdrawals.sent_at IS
  'When admin marked withdrawal as sent externally (status transition approved → sent).';
COMMENT ON COLUMN withdrawals.sent_by IS
  'Which admin clicked "Mark sent" (FK to users.id, admin only).';

COMMIT;
