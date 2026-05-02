-- Fix: Add UPDATE policy on branches for admins.
-- The webhook config modal in branch-actions.tsx does a direct .update()
-- on branches, but only SELECT policies existed for admins.
-- All other admin mutations use SECURITY DEFINER RPCs, but webhook config
-- is a simple column update that doesn't need PIN verification.

CREATE POLICY "Admins can update branches"
  ON branches FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));
