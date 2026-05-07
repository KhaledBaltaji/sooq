-- ============================================================================
-- Migration 0035 — Sprint B polish (NGR documentation + duplicate key cleanup)
-- ============================================================================
--
-- Three small, independent cleanups grouped into one migration:
--
-- 1. NGR table + column comments (Item 4 in the cleanup plan)
--    Today's net/ngr typo outage was partly caused by engineers thinking the
--    column was named "net" when it's actually "ngr". Add explicit comments
--    on the table + column so anyone reading \d+ output sees the right name
--    immediately. Pure documentation, zero behavior change.
--
-- 2. Drop the duplicate `speed_per_user_per_market_cap_usd` key if it exists
--    (Item 5 in the cleanup plan). This was an alias for `speed_cap_per_side_usd`
--    that lived in seeds and was parsed by queries.ts but is not currently
--    in the staging database (verified via SELECT before this migration). If
--    a future seed accidentally re-introduces it, this migration drops it
--    cleanly. Idempotent.
--
-- 3. No function changes — pure schema/docs migration. drizzle/functions/
--    stays untouched.

SET search_path = public;

-- ── 1. NGR table + column comments ────────────────────────────────────

COMMENT ON TABLE speed_daily_ngr IS
  'Daily Net Gaming Revenue tracking for Speed mode. One row per UTC day. Updated atomically by _speed_update_daily_ngr() on every settled trade/cashout/refund. The circuit_tripped_at column is set by the same helper when ngr drops below the speed_daily_ngr_floor threshold; the trade RPC checks this column before allowing new entries (mig 0028 single-tier breaker; mig 0034 added 3-tier alert/soft-block/hard-stop layered on top of this same field).';

COMMENT ON COLUMN speed_daily_ngr.ngr_date IS
  'UTC date this row covers. Computed via _speed_utc_today() to be timezone-invariant.';

COMMENT ON COLUMN speed_daily_ngr.stake_in IS
  'Sum of stakes accepted on Speed bets that opened this UTC day. Money flowing IN to the platform.';

COMMENT ON COLUMN speed_daily_ngr.payout_out IS
  'Sum of payouts to winners settled this UTC day. Money flowing OUT.';

COMMENT ON COLUMN speed_daily_ngr.cashout_out IS
  'Sum of cashout amounts paid this UTC day (winning + losing cashouts both included). Money flowing OUT.';

COMMENT ON COLUMN speed_daily_ngr.refund_out IS
  'Sum of refunds paid for voided/at_strike markets this UTC day. Money flowing OUT.';

COMMENT ON COLUMN speed_daily_ngr.ngr IS
  'Net Gaming Revenue for the day. Computed by _speed_update_daily_ngr() as: stake_in - payout_out - cashout_out - refund_out. This is the canonical column name. Engineering shorthand sometimes calls this "net" — DO NOT use that name in SQL; the column is "ngr".';

COMMENT ON COLUMN speed_daily_ngr.circuit_tripped_at IS
  'Timestamp the daily loss circuit breaker fired. NULL means the day is OK. Set by _speed_update_daily_ngr() when ngr < speed_daily_ngr_floor. Once set, speed_execute_trade rejects all new entries until UTC midnight (when a new ngr_date row is created).';

COMMENT ON COLUMN speed_daily_ngr.updated_at IS
  'Last write timestamp; updated on every NGR mutation.';

-- ── 2. Drop duplicate fee_config key if it accidentally exists ────────

DELETE FROM fee_config
 WHERE fee_type = 'speed_per_user_per_market_cap_usd'
   AND NOT EXISTS (
     -- Safety: only drop if speed_cap_per_side_usd exists with the same value,
     -- so we never delete the only remaining cap-per-side configuration.
     SELECT 1 FROM fee_config
     WHERE fee_type = 'speed_cap_per_side_usd'
   );

-- ── 3. No function changes ────────────────────────────────────────────
-- (drizzle/functions/ unchanged for this migration)
