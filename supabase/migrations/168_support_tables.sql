-- 168_support_tables.sql — Support ticket system (Phase 1: Slack bridge MVP)

BEGIN;

-- ============================================================
-- 1. support_tickets — one per user issue
-- ============================================================

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web')),
  category TEXT NOT NULL CHECK (category IN ('account', 'deposit', 'withdrawal', 'trading', 'market', 'referral', 'other')),
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_support_tickets_user_status ON support_tickets(user_id, status);
CREATE INDEX idx_support_tickets_updated ON support_tickets(updated_at DESC);

-- ============================================================
-- 2. support_messages — append-only per ticket
-- ============================================================

CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin', 'system')),
  content TEXT NOT NULL CHECK (char_length(content) <= 2000),
  message_id UUID UNIQUE,  -- client-generated idempotency key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id, created_at);

-- ============================================================
-- 3. RLS Policies
-- ============================================================

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own tickets
CREATE POLICY "Users read own tickets"
  ON support_tickets FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create tickets
CREATE POLICY "Users create tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tickets (close)
CREATE POLICY "Users update own tickets"
  ON support_tickets FOR UPDATE
  USING (auth.uid() = user_id);

-- Admin reads all tickets
CREATE POLICY "Admin reads all tickets"
  ON support_tickets FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin updates any ticket (resolve, close)
CREATE POLICY "Admin updates any ticket"
  ON support_tickets FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Users read messages on their own tickets
CREATE POLICY "Users read own ticket messages"
  ON support_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM support_tickets WHERE id = ticket_id AND user_id = auth.uid())
  );

-- Users insert messages to their own open tickets
CREATE POLICY "Users insert messages to own open tickets"
  ON support_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE id = ticket_id AND user_id = auth.uid() AND status = 'open'
    )
  );

-- Admin reads all messages
CREATE POLICY "Admin reads all messages"
  ON support_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin inserts messages to any ticket
CREATE POLICY "Admin inserts messages to any ticket"
  ON support_messages FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Service role has full access (implicit, no policy needed)

-- ============================================================
-- 4. Realtime — enable for live message updates
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;

COMMIT;
