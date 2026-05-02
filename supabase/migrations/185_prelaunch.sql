-- Migration 185: Prelaunch "Shu Ra2yak?" prediction game tables
-- Self-contained tables for anonymous voting + waitlist. No auth required.

BEGIN;

-- =============================================================================
-- TABLE: prelaunch_questions
-- =============================================================================
CREATE TABLE prelaunch_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_ar TEXT,
  description_en TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  yes_count INTEGER NOT NULL DEFAULT 0,
  no_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prelaunch_questions_active ON prelaunch_questions (active, sort_order);

-- =============================================================================
-- TABLE: prelaunch_votes
-- =============================================================================
CREATE TABLE prelaunch_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES prelaunch_questions(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, visitor_id)
);

CREATE INDEX idx_prelaunch_votes_question ON prelaunch_votes (question_id);
CREATE INDEX idx_prelaunch_votes_visitor ON prelaunch_votes (visitor_id);

-- =============================================================================
-- TABLE: prelaunch_waitlist
-- =============================================================================
CREATE TABLE prelaunch_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  position SERIAL,
  referral_code TEXT NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
  referred_by TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  votes_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prelaunch_waitlist_referral ON prelaunch_waitlist (referral_code);

-- =============================================================================
-- RPC: record_prelaunch_vote
-- Atomic vote insert + count increment. Returns updated counts + user vote.
-- On duplicate visitor, returns existing vote and current counts.
-- =============================================================================
CREATE OR REPLACE FUNCTION record_prelaunch_vote(
  p_question_id UUID,
  p_vote TEXT,
  p_visitor_id TEXT
)
RETURNS TABLE(yes_count INTEGER, no_count INTEGER, user_vote TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_vote TEXT;
BEGIN
  -- Check if visitor already voted on this question
  SELECT pv.vote INTO v_existing_vote
  FROM prelaunch_votes pv
  WHERE pv.question_id = p_question_id AND pv.visitor_id = p_visitor_id;

  IF v_existing_vote IS NOT NULL THEN
    -- Already voted — return existing vote + current counts
    RETURN QUERY
      SELECT pq.yes_count, pq.no_count, v_existing_vote
      FROM prelaunch_questions pq
      WHERE pq.id = p_question_id;
    RETURN;
  END IF;

  -- Insert the vote
  INSERT INTO prelaunch_votes (question_id, visitor_id, vote)
  VALUES (p_question_id, p_visitor_id, p_vote);

  -- Atomic increment
  IF p_vote = 'yes' THEN
    UPDATE prelaunch_questions SET yes_count = prelaunch_questions.yes_count + 1
    WHERE prelaunch_questions.id = p_question_id;
  ELSE
    UPDATE prelaunch_questions SET no_count = prelaunch_questions.no_count + 1
    WHERE prelaunch_questions.id = p_question_id;
  END IF;

  -- Return updated counts
  RETURN QUERY
    SELECT pq.yes_count, pq.no_count, p_vote
    FROM prelaunch_questions pq
    WHERE pq.id = p_question_id;
END;
$$;

-- =============================================================================
-- RPC: increment_referral_count
-- Atomic increment for referral tracking on waitlist signup.
-- =============================================================================
CREATE OR REPLACE FUNCTION increment_referral_count(p_referral_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE prelaunch_waitlist
  SET referral_count = referral_count + 1
  WHERE referral_code = p_referral_code;
END;
$$;

-- =============================================================================
-- RLS Policies
-- =============================================================================
ALTER TABLE prelaunch_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prelaunch_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prelaunch_waitlist ENABLE ROW LEVEL SECURITY;

-- Questions: public read
CREATE POLICY "prelaunch_questions_public_read" ON prelaunch_questions
  FOR SELECT USING (true);

-- Votes: public read + insert
CREATE POLICY "prelaunch_votes_public_read" ON prelaunch_votes
  FOR SELECT USING (true);

CREATE POLICY "prelaunch_votes_public_insert" ON prelaunch_votes
  FOR INSERT WITH CHECK (true);

-- Waitlist: public read + insert
CREATE POLICY "prelaunch_waitlist_public_read" ON prelaunch_waitlist
  FOR SELECT USING (true);

CREATE POLICY "prelaunch_waitlist_public_insert" ON prelaunch_waitlist
  FOR INSERT WITH CHECK (true);

-- =============================================================================
-- Seed Data: 5 Lebanese prediction questions
-- =============================================================================
INSERT INTO prelaunch_questions (slug, title_ar, title_en, description_ar, description_en, category, sort_order) VALUES
  (
    'dollar-100k-summer',
    'هل يوصل سعر الدولار ل ١٠٠,٠٠٠ قبل الصيف؟',
    'Will the dollar hit 100,000 LBP before summer?',
    NULL, NULL,
    'economy', 1
  ),
  (
    '24hr-electricity-2026',
    'هل رح يكون في كهربا ٢٤/٢٤ بلبنان هالسنة؟',
    'Will Lebanon get 24hr electricity this year?',
    NULL, NULL,
    'politics', 2
  ),
  (
    'ansar-nejmeh-derby',
    'مين رح يربح الديربي — الأنصار ولا النجمة؟',
    'Who wins the derby — Ansar or Nejmeh?',
    'نعم = الأنصار، لا = النجمة',
    'YES = Ansar, NO = Nejmeh',
    'sports', 3
  ),
  (
    'government-formation-may',
    'هل رح تتشكل الحكومة قبل أيار؟',
    'Will the government be formed before May?',
    NULL, NULL,
    'politics', 4
  ),
  (
    'rain-beirut-april',
    'هل رح تشتي ببيروت هالأسبوع؟',
    'Will it rain in Beirut this week?',
    NULL, NULL,
    'weather', 5
  );

COMMIT;
