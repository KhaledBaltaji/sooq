-- 180: Fix resolve_market search_path to include extensions schema
--
-- Migration 179 set search_path = public, but pgcrypto's crypt() function
-- lives in the extensions schema on Supabase. This caused "function crypt(text, text)
-- does not exist" errors. Fix: include extensions in search_path.

ALTER FUNCTION resolve_market(UUID, bet_side, TEXT)
SET search_path = public, extensions;
