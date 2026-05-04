-- 0019_speed_duration_add_1h.sql
--
-- Add '1h' to the speed_duration enum so the cron + RPC can create new
-- 1h markets. The enum was originally ('5m', '15m', '24h') (mig 0000).
-- CLAUDE.md / mig 0016 declared 5m + 1h the active set, but no migration
-- ever actually added '1h' to the enum — so writes with duration='1h'
-- failed with "invalid input value for enum speed_duration: '1h'".
--
-- Existing values '5m', '15m', '24h' are kept (Postgres doesn't support
-- enum value removal without a full type rewrite, and historical settled
-- positions still reference them). The trade RPC + public list endpoint
-- already filter to the active set; this migration simply makes '1h' a
-- legal value so the cron in mig 0020 can create them.
--
-- Must run alone (separate Drizzle migration file) — Postgres rejects
-- using a newly-added enum value in the same transaction that added it.
-- mig 0020 then updates the cron + boundary helper to USE '1h'.

ALTER TYPE public.speed_duration ADD VALUE IF NOT EXISTS '1h';
