-- 273_demo_trades_realtime.sql — add demo_trades to realtime publication
--
-- Migration 270 added demo_markets, demo_amm_state, and demo_positions to
-- supabase_realtime but missed demo_trades. The price chart subscribes to
-- INSERT events on demo_trades to animate real-time price updates as demo
-- users trade. Without this, demo charts never move in real time even
-- though the underlying AMM state does update correctly.
--
-- This is additive and safe: demo_trades is already user-scoped by RLS,
-- so the realtime channel only delivers rows the subscriber can read.

BEGIN;

ALTER PUBLICATION supabase_realtime ADD TABLE demo_trades;

COMMIT;
