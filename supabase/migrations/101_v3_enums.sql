-- 101_v3_enums.sql — V3 Migration: New enums and extend existing ones
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction block in Postgres.
-- This file intentionally has NO BEGIN/COMMIT wrapper.

-- ============================================================
-- 1. New enum: trade_direction (buy/sell)
-- ============================================================

CREATE TYPE trade_direction AS ENUM ('buy', 'sell');

-- ============================================================
-- 2. New enum: alert_direction (for price alerts)
-- ============================================================

CREATE TYPE alert_direction AS ENUM ('above', 'below');

-- ============================================================
-- 3. Extend transaction_type with V3 types
-- ============================================================

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'trade';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'cash_out';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'resolution_payout';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'resolution_fee';
