-- Migration 261: Drop legacy non-PIN admin functions (security cleanup)
--
-- Three legacy admin functions remained installed despite their PIN-protected
-- replacements existing. They bypass the PIN gate added in migrations 152/247
-- and are EXECUTE-granted to the 'authenticated' role, so any admin session
-- (or hijacked admin token) can call them directly via the REST API and
-- sidestep the PIN requirement that was explicitly added to protect money
-- mutations.
--
-- 1. withdrawal_approve(UUID, TEXT) — replaced by admin_review_withdrawal (mig 243)
-- 2. withdrawal_reject(UUID, TEXT)  — replaced by admin_review_withdrawal (mig 243)
-- 3. resolve_market(UUID, bet_side) — replaced by 3-arg PIN version (mig 220)
--
-- Confirmed (read-only audit pre-migration): no code in src/ calls any of
-- these three legacy signatures. UI uses the PIN-protected replacements
-- exclusively. This mirrors the pattern in migration 249 which dropped
-- legacy lock_market(UUID) and void_market(UUID) for the same reason.

-- Withdrawal approve/reject (legacy, no PIN, no audit log)
REVOKE EXECUTE ON FUNCTION public.withdrawal_approve(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.withdrawal_reject(UUID, TEXT)  FROM PUBLIC, authenticated, anon;
DROP FUNCTION IF EXISTS public.withdrawal_approve(UUID, TEXT);
DROP FUNCTION IF EXISTS public.withdrawal_reject(UUID, TEXT);

-- Legacy 2-arg resolve_market (no PIN). The 3-arg PIN-protected version
-- resolve_market(UUID, bet_side, TEXT) added in migration 220 remains.
DROP FUNCTION IF EXISTS public.resolve_market(UUID, bet_side);
