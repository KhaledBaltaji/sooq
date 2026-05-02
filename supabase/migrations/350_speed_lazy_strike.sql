-- ============================================================================
-- 350_speed_lazy_strike.sql
--
-- Speed-market strike-price capture happens at market launch (`opens_at`),
-- not at cron-firing time. Fixes a one-full-duration strike lag (5m → 5min
-- stale, 15m → 15min, 1h → 1h, 24h → 24h) that surfaced as a wrong-looking
-- strike line on the chart for every speed-market window.
--
-- Mechanism (3 pieces, all in this file):
--   1. `speed_markets.strike_price` is now nullable. New "pending" rows
--      carry NULL strike — they are placeholders for the next clean boundary.
--   2. `speed_finalize_pending_markets()` walks pending rows whose opens_at
--      has arrived, copies the current `speed_oracle_latest.price` into
--      strike_price, and flips status → 'open'.
--   3. A trigger on `speed_oracle_latest` (AFTER INSERT OR UPDATE, FOR EACH
--      STATEMENT) calls (2) on every oracle tick. The Binance speed-oracle
--      worker upserts `speed_oracle_latest` once per second, so any pending
--      market is finalized within ~1 second of its opens_at.
--   4. `speed_roll_markets()` is rewritten to insert pending rows with
--      strike_price=NULL, status='pending'. It also runs the finalize pass
--      itself as defense-in-depth (covers oracle-worker downtime: cron is
--      every minute, so worst-case strike lag is 1 minute even if the
--      trigger never fires).
--
-- The `speed_market_status` enum already has 'pending' (mig 306). The table
-- already defaults `status` to 'pending' (mig 308). The original design
-- intent in those migrations was lazy strike capture — this migration
-- finally implements it.
--
-- speed_execute_trade (mig 345 line 188) already gates on `status = 'open'`,
-- so pending markets are unreachable via the trade RPC. No trade-gate edits.
--
-- Existing rows (all status in {open, resolving, resolved, voided, halted})
-- are untouched and remain valid under the loosened CHECK. Currently-open
-- markets keep their stale strikes per user decision (no in-place backfill).
-- ============================================================================

-- ─── 1. Loosen strike_price: allow NULL, keep > 0 invariant when set ────────

ALTER TABLE speed_markets
  DROP CONSTRAINT IF EXISTS speed_markets_strike_price_check;

ALTER TABLE speed_markets
  ALTER COLUMN strike_price DROP NOT NULL;

ALTER TABLE speed_markets
  ADD CONSTRAINT speed_markets_strike_price_check
  CHECK (strike_price IS NULL OR strike_price > 0);

COMMENT ON CONSTRAINT speed_markets_strike_price_check ON speed_markets IS
'NULL allowed only while a row is in pending state — finalized to (oracle.price > 0) when status flips to open. Resolved/voided/halted rows always have strike set (their status came from open).';

-- ─── 2. speed_finalize_pending_markets() ─────────────────────────────────────
-- Sweeps pending rows whose opens_at has arrived. Atomic per-row UPDATE
-- joining `speed_oracle_latest`; rows with no matching oracle row stay
-- pending (no oracle = no strike — let next call retry).

CREATE OR REPLACE FUNCTION speed_finalize_pending_markets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH finalized AS (
    UPDATE speed_markets m
    SET
      strike_price = o.price,
      status       = 'open',
      updated_at   = NOW()
    FROM speed_oracle_latest o
    WHERE m.status        = 'pending'
      AND m.strike_price IS NULL
      AND m.opens_at     <= NOW()
      AND o.asset         = m.asset
    RETURNING m.id
  )
  SELECT COUNT(*) INTO v_count FROM finalized;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION speed_finalize_pending_markets() IS
'Finalizes any pending speed_market whose opens_at has arrived: sets strike_price from speed_oracle_latest.price for the matching asset and flips status to open. Returns row count. Idempotent — pending rows with NULL oracle stay pending.';

-- ─── 3. Oracle-tick trigger ──────────────────────────────────────────────────
-- AFTER INSERT OR UPDATE on speed_oracle_latest. STATEMENT-level (not
-- per-row) because the table is one-row-per-asset and finalize() doesn't
-- need NEW. Trigger function is SECURITY DEFINER via the function it calls.

CREATE OR REPLACE FUNCTION trg_speed_finalize_on_oracle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM speed_finalize_pending_markets();
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION trg_speed_finalize_on_oracle() IS
'Trigger body for speed_oracle_finalize_pending. Calls speed_finalize_pending_markets() on every oracle upsert so newly-mature pending markets pick up a strike within ~1 second.';

DROP TRIGGER IF EXISTS speed_oracle_finalize_pending ON speed_oracle_latest;
CREATE TRIGGER speed_oracle_finalize_pending
  AFTER INSERT OR UPDATE ON speed_oracle_latest
  FOR EACH STATEMENT
  EXECUTE FUNCTION trg_speed_finalize_on_oracle();

COMMENT ON TRIGGER speed_oracle_finalize_pending ON speed_oracle_latest IS
'Strike-at-launch hook (mig 350): every oracle upsert flushes any pending speed_market past its opens_at. Worker upserts at 1Hz, so strike lag ≤ ~1 second.';

-- ─── 4. speed_roll_markets() — pending insert + defense-in-depth finalize ────
-- Mig 347 inserted boundary rows with the cron-time oracle price as strike.
-- We replace that with strike_price=NULL, status='pending'. The trigger
-- finalizes when opens_at arrives. Cron also calls finalize after the
-- insert pass — covers oracle-worker downtime spanning a boundary.

CREATE OR REPLACE FUNCTION speed_roll_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_master_enabled    DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_assets            speed_asset[];
  v_durations         speed_duration[];
  v_asset             speed_asset;
  v_duration          speed_duration;
  v_oracle            RECORD;
  v_opens_at          TIMESTAMPTZ;
  v_closes_at         TIMESTAMPTZ;
  v_market_id         UUID;
  v_created_count     INTEGER := 0;
  v_skipped_count     INTEGER := 0;
  v_finalized_count   INTEGER := 0;
  v_created_markets   JSONB := '[]'::JSONB;
BEGIN
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'master_kill_active', 'created', 0);
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  v_assets    := ARRAY['BTC']::speed_asset[];
  v_durations := ARRAY['5m', '15m', '1h', '24h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
    -- Oracle freshness gate: no fresh oracle → no new markets created. The
    -- pending row would have to wait for a tick to finalize anyway, but
    -- we'd rather not queue boundary rows during an outage.
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset;
    IF v_oracle IS NULL
       OR EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      v_opens_at  := _next_clean_boundary(v_duration, NOW());
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '1h'::speed_duration  THEN v_opens_at + INTERVAL '1 hour'
        WHEN '24h'::speed_duration THEN v_opens_at + INTERVAL '1 day'
      END;

      -- 24h defensive guard preserved from mig 341 / 347.
      IF v_duration = '24h' AND v_closes_at - NOW() < INTERVAL '1 hour' THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_market_id := NULL;

      INSERT INTO speed_markets (
        asset, duration, strike_price, opens_at, closes_at, status
      ) VALUES (
        v_asset, v_duration, NULL, v_opens_at, v_closes_at, 'pending'
      )
      ON CONFLICT (asset, duration, opens_at) DO NOTHING
      RETURNING id INTO v_market_id;

      IF v_market_id IS NULL THEN
        v_skipped_count := v_skipped_count + 1;
      ELSE
        v_created_count := v_created_count + 1;
        v_created_markets := v_created_markets || jsonb_build_object(
          'id',        v_market_id,
          'asset',     v_asset,
          'duration',  v_duration,
          'opens_at',  v_opens_at,
          'closes_at', v_closes_at
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Defense-in-depth: catch any pending rows the oracle trigger missed
  -- (e.g., oracle-worker outage spanning a boundary). Cron is every minute,
  -- so this caps worst-case strike lag at 1 minute when the trigger silent.
  v_finalized_count := speed_finalize_pending_markets();

  RETURN jsonb_build_object(
    'success',   TRUE,
    'created',   v_created_count,
    'skipped',   v_skipped_count,
    'finalized', v_finalized_count,
    'markets',   v_created_markets
  );
END;
$$;

COMMENT ON FUNCTION speed_roll_markets() IS
'Cron entrypoint. Inserts pending speed-markets at the next clean boundary (NULL strike, status=pending) and runs a defense-in-depth finalize pass for any pending markets whose opens_at has arrived. Strike capture is owned by the speed_oracle_latest trigger (mig 350) — this function is the failsafe.';
