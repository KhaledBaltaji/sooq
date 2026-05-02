-- 246_fee_config_unique_dedupe.sql — Fix fee_config UNIQUE constraint NULL handling
--
-- Phase 1 audit fix (P1-03): the original UNIQUE(fee_type, level, depth) from
-- migration 009 treats NULL values as distinct (PostgreSQL default behavior).
-- That allowed duplicate rows for fees where level + depth are NULL, e.g.
--   ('cash_out_premium', NULL, NULL) — 2 rows
--   ('dynamic_spread_threshold', NULL, NULL) — 2 rows with conflicting values (0.65 and 0.05)
--
-- Every RPC that reads fee_config does:
--   SELECT rate FROM fee_config WHERE fee_type = X LIMIT 1
-- with no ORDER BY — so duplicates yield non-deterministic rates between trades.
-- Confirmed on staging: dynamic_spread_threshold returns 0.05 OR 0.65 randomly.
--
-- Fix:
-- 1. Pre-flight: log every duplicate group into system_logs for forensics
-- 2. Dedupe: keep the row with MIN(id) per canonical (fee_type, COALESCE(level,-1), COALESCE(depth,-1))
--    For dynamic_spread_*: explicitly preserve the documented values (0.65 / 1.5),
--    not whichever happens to have the lower id.
-- 3. Drop original UNIQUE; add COALESCE-based unique index that treats NULLs as equal.
--
-- All RPCs that read fee_config also get an `ORDER BY id` to make read-time
-- deterministic — that's done in their respective re-definitions (migration 245
-- for resolution paths; future migrations for trade paths).

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Pre-flight: snapshot every duplicate group for the audit log
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_dup RECORD;
BEGIN
  FOR v_dup IN
    SELECT
      fee_type,
      level,
      depth,
      COUNT(*) AS dup_count,
      array_agg(id ORDER BY id) AS row_ids,
      array_agg(rate ORDER BY id) AS rates
    FROM fee_config
    GROUP BY fee_type, level, depth
    HAVING COUNT(*) > 1
  LOOP
    INSERT INTO system_logs (severity, source, message, context)
    VALUES (
      'warn',
      'migration/fee_config_dedupe',
      format('Pre-dedupe: %s duplicate rows found for fee_type=%s', v_dup.dup_count, v_dup.fee_type),
      jsonb_build_object(
        'fee_type', v_dup.fee_type,
        'level', v_dup.level,
        'depth', v_dup.depth,
        'duplicate_count', v_dup.dup_count,
        'row_ids', v_dup.row_ids,
        'rates', v_dup.rates
      )
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 2. Pin canonical values for known-conflicting fee types BEFORE dedupe
--    so the kept row has the documented value regardless of insertion order.
-- ═══════════════════════════════════════════════════════════

-- dynamic_spread_threshold: V3 spec is 0.65 (per migration 103). 0.05 is wrong.
UPDATE fee_config SET rate = 0.650000
WHERE fee_type = 'dynamic_spread_threshold'
  AND id = (SELECT id FROM fee_config WHERE fee_type = 'dynamic_spread_threshold' ORDER BY id LIMIT 1);

-- dynamic_spread_multiplier: V3 spec is 1.5 (per migration 103). 0.5 is wrong.
UPDATE fee_config SET rate = 1.500000
WHERE fee_type = 'dynamic_spread_multiplier'
  AND id = (SELECT id FROM fee_config WHERE fee_type = 'dynamic_spread_multiplier' ORDER BY id LIMIT 1);

-- ═══════════════════════════════════════════════════════════
-- 3. Dedupe: keep MIN(id) per canonical group, delete the rest
-- ═══════════════════════════════════════════════════════════

DELETE FROM fee_config
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY fee_type, COALESCE(level, -1), COALESCE(depth, -1)
        ORDER BY id
      ) AS rn
    FROM fee_config
  ) ranked
  WHERE ranked.rn > 1
);

-- ═══════════════════════════════════════════════════════════
-- 4. Drop the original UNIQUE constraint (NULLS-distinct broken)
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fee_config'::regclass
      AND conname = 'fee_config_fee_type_level_depth_key'
  ) THEN
    ALTER TABLE fee_config DROP CONSTRAINT fee_config_fee_type_level_depth_key;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 5. Add COALESCE-based UNIQUE INDEX that treats NULLs as equal
--    Works on PG12+ — no NULLS NOT DISTINCT requirement (PG15+).
-- ═══════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS fee_config_canonical_idx
  ON fee_config (fee_type, COALESCE(level, -1), COALESCE(depth, -1));

-- ═══════════════════════════════════════════════════════════
-- 6. Post-dedupe verification: zero duplicates allowed
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM (
    SELECT 1
    FROM fee_config
    GROUP BY fee_type, COALESCE(level, -1), COALESCE(depth, -1)
    HAVING COUNT(*) > 1
  ) AS dups;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'fee_config dedupe failed: % duplicate groups remain', v_remaining;
  END IF;

  -- Audit success
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (
    'info',
    'migration/fee_config_dedupe',
    'fee_config dedupe complete — 0 duplicate groups remain, COALESCE unique index installed',
    jsonb_build_object(
      'total_rows', (SELECT COUNT(*) FROM fee_config)
    )
  );
END $$;

COMMIT;
