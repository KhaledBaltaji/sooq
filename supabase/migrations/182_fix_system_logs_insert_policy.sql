-- Fix: restrict system_logs INSERT to service_role only.
-- The old policy WITH CHECK (TRUE) allowed any authenticated user to insert.
-- log_system_event() is SECURITY DEFINER so it bypasses RLS — no breakage.

DROP POLICY IF EXISTS "Service role can insert system_logs" ON system_logs;

CREATE POLICY "Service role can insert system_logs"
  ON system_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
