-- ============================================================
-- 208: S2 Branch System — Retail isolation views
--
-- These views filter out branch data from retail queries.
-- Any existing query that reads trades or positions without a
-- branch_id filter will silently include branch data. These
-- views are the real safety net for data isolation.
--
-- CEO Review addition: prevents 15+ existing queries from
-- leaking branch data into retail views.
-- ============================================================

-- Retail-only trades (excludes branch trades)
CREATE OR REPLACE VIEW retail_trades AS
  SELECT * FROM trades WHERE branch_id IS NULL;

-- Retail-only positions (excludes branch positions)
CREATE OR REPLACE VIEW retail_positions AS
  SELECT * FROM positions WHERE branch_id IS NULL;
