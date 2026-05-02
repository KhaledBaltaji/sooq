-- 105_v3_realtime.sql — V3 Migration: Enable Realtime on new tables

-- Note: bets was already removed from publication in 100_v3_drop_v2.sql
-- markets and notifications remain from 050_realtime.sql

ALTER PUBLICATION supabase_realtime ADD TABLE amm_state;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE positions;
