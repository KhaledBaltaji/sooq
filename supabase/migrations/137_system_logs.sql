-- 137_system_logs.sql — System error/event logging for observability

CREATE TYPE log_severity AS ENUM ('info', 'warn', 'error', 'critical');

CREATE TABLE system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity log_severity NOT NULL DEFAULT 'error',
  source TEXT NOT NULL,           -- 'pg/execute_trade', 'webhook/3pay', 'api/health', etc.
  message TEXT NOT NULL,
  context JSONB DEFAULT '{}',     -- { userId, marketId, amount, etc. }
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX idx_system_logs_severity ON system_logs(severity);
CREATE INDEX idx_system_logs_source ON system_logs(source);
CREATE INDEX idx_system_logs_created_at ON system_logs(created_at DESC);
CREATE INDEX idx_system_logs_unacknowledged ON system_logs(acknowledged) WHERE acknowledged = FALSE;

-- Helper function for Postgres functions to log errors
CREATE OR REPLACE FUNCTION log_system_event(
  p_severity log_severity,
  p_source TEXT,
  p_message TEXT,
  p_context JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (p_severity, p_source, p_message, p_context);
END;
$$;

-- RPC to acknowledge a log entry (admin only)
CREATE OR REPLACE FUNCTION acknowledge_system_log(p_log_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin FROM users WHERE id = v_user_id;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE system_logs
  SET acknowledged = TRUE,
      acknowledged_by = v_user_id,
      acknowledged_at = NOW()
  WHERE id = p_log_id;
END;
$$;

-- RLS: admins can read, service role can write
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read system_logs"
  ON system_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Service role can insert system_logs"
  ON system_logs FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Admins can update system_logs"
  ON system_logs FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  );
