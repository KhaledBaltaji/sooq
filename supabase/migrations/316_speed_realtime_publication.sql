-- ============================================================================
-- 316_speed_realtime_publication.sql
--
-- Adds the four speed_* tables that should broadcast via Supabase Realtime
-- to the supabase_realtime publication. Other speed_* tables MUST NOT be
-- in the publication — at speed-market write rates they would saturate.
--
-- IN publication (4 tables):
--   - speed_markets         (status changes propagate to user app)
--   - speed_oracle_latest   (live BTC price tick to user app)
--   - speed_exposure_live   (per-branch exposure for ops panel + branch dashboard)
--   - speed_market_exposure_live (per-market exposure for ops panel)
--
-- NOT in publication (would saturate):
--   - speed_trades, speed_pool_ledger, speed_oracle_ticks, speed_settlements,
--     speed_positions, speed_external_book_snapshots, speed_branches.
--
-- Separate from table creation so rollback is easy: drop publication entries
-- without affecting the tables themselves.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE speed_markets;
ALTER PUBLICATION supabase_realtime ADD TABLE speed_oracle_latest;
ALTER PUBLICATION supabase_realtime ADD TABLE speed_exposure_live;
ALTER PUBLICATION supabase_realtime ADD TABLE speed_market_exposure_live;
