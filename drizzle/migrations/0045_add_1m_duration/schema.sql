-- ============================================================================
-- Migration 0045 — Add '1m' to speed_duration enum (Sprint 3 prep)
-- ============================================================================
--
-- Standalone migration. PostgreSQL allows ALTER TYPE ADD VALUE inside a
-- transaction, but the newly-added value cannot be used in the SAME
-- transaction. So this enum addition must complete + commit before any
-- mig that references '1m' (which is mig 0046).
--
-- IF NOT EXISTS makes this idempotent.

ALTER TYPE speed_duration ADD VALUE IF NOT EXISTS '1m';
