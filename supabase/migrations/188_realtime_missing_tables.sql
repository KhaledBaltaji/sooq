-- Add missing tables to Realtime publication
-- These tables have channel subscriptions in the frontend but were never added to the publication.
-- Without this, those subscriptions silently receive no events.

ALTER PUBLICATION supabase_realtime ADD TABLE deposits;
ALTER PUBLICATION supabase_realtime ADD TABLE market_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE referral_commissions;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
