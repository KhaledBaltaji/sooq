-- 197: Fix search_path for admin PIN/fee SECURITY DEFINER functions.
-- crypt()/gen_salt() from pgcrypto live in extensions schema on Supabase,
-- causing "function crypt(text, text) does not exist" errors.

ALTER FUNCTION admin_adjust_balance(UUID, DECIMAL, TEXT, TEXT)
SET search_path = public, extensions;

ALTER FUNCTION admin_set_pin(TEXT)
SET search_path = public, extensions;

ALTER FUNCTION admin_has_pin()
SET search_path = public, extensions;

ALTER FUNCTION admin_update_fee(UUID, DECIMAL, TEXT)
SET search_path = public, extensions;
