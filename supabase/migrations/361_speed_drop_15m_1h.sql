-- ============================================================================
-- 361_speed_drop_15m_1h.sql
--
-- Drop 15m and 1h speed-market durations. Going forward only 5m and 24h
-- ship — the user found 15m and 1h gave noisy UX (too short to tell a
-- coherent story; too long to feel like a quick game) and decided to
-- collapse the offering before launch.
--
-- Two changes:
--   1. speed_roll_markets() durations array: ['5m','15m','1h','24h'] →
--      ['5m','24h']. The CASE statement still handles 15m/1h labels for
--      historical resolves but new markets won't be created.
--   2. Void any currently-pending or open 15m/1h markets via the standard
--      _void_market_internal path so positions (if any) are refunded
--      cleanly. On staging this is 0 positions but production might land
--      with active 15m/1h on rollout — gracefully refund.
--
-- The speed_duration enum is intentionally left alone so historical 15m
-- and 1h markets remain queryable (resolved/voided rows reference these
-- enum values). Frontend filters them out by passing only ['5m','24h']
-- to the markets feed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.speed_roll_markets()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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
  -- Mig 361: dropped '15m' and '1h' — only 5m and 24h ship from here.
  v_durations := ARRAY['5m', '24h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
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

COMMENT ON FUNCTION public.speed_roll_markets() IS
'Mig 361: dropped 15m and 1h durations from the rolling-creation array. Only 5m and 24h are created going forward; existing 15m/1h rows resolve normally but no new ones spawn.';

-- ── Void any currently-pending or open 15m/1h markets ──────────────────
-- speed markets don't have a generic _void_market_internal; the void path
-- is inside speed_resolve_market and only fires after closes_at. We need
-- to retire these PROACTIVELY (before closes_at) so they don't sit in the
-- UI as zombie 15m/1h bets, so we open-code the refund flow here.
--
-- Inlines the same logic speed_resolve_market uses on its void branch:
-- refund stake + status='refunded' on positions, refund ledger entry
-- to the appropriate pool, transactions row, notifications row,
-- speed_settlements row keyed at_strike. Then mark the market voided.
--
-- On staging this is 4 markets with 0 positions; the position loop is a
-- safety net for production where any active 15m/1h bets at deploy time
-- get cleanly refunded.
DO $$
DECLARE
  v_market         RECORD;
  v_pos            RECORD;
  v_new_balance    DECIMAL;
  v_new_pool       DECIMAL;
  v_main_locked    BOOLEAN;
  v_main_pool      RECORD;
  v_voided_count   INTEGER := 0;
  v_refund_count   INTEGER := 0;
BEGIN
  FOR v_market IN
    SELECT * FROM speed_markets
    WHERE duration IN ('15m'::speed_duration, '1h'::speed_duration)
      AND status IN ('pending', 'open')
    ORDER BY closes_at
    FOR UPDATE
  LOOP
    v_main_locked := FALSE;

    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = v_market.id AND status = 'open'
      FOR UPDATE
    LOOP
      -- Refund stake to user
      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
              'Speed market voided — 15m/1h discontinued (mig 361)');

      UPDATE speed_positions
      SET status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      -- Pool ledger entry
      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool
        FROM speed_branches WHERE branch_id = v_pos.branch_id FOR UPDATE;
        v_new_pool := v_new_pool - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, v_market.id, 'refund', -v_pos.stake, v_new_pool, v_pos.id,
                'Refund (15m/1h dropped — mig 361)');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool WHERE branch_id = v_pos.branch_id;
      ELSE
        IF NOT v_main_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          v_main_locked := TRUE;
          v_new_pool := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool := v_new_pool - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, v_market.id, 'refund', -v_pos.stake, v_new_pool, v_pos.id,
                'Refund from main pool (15m/1h dropped — mig 361)');
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, v_market.id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_voided',
              'Speed market voided', 'تم إلغاء السوق السريع',
              'Your ' || v_market.asset || ' ' || v_market.duration || ' bet was refunded ($' || ROUND(v_pos.stake, 2) || ').',
              'تم إعادة رهانك ' || v_market.asset || ' ' || v_market.duration || ' ($' || ROUND(v_pos.stake, 2) || ').',
              v_pos.id);

      v_refund_count := v_refund_count + 1;
    END LOOP;

    IF v_main_locked THEN
      UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool, updated_at = NOW() WHERE id = 1;
    END IF;

    UPDATE speed_markets
    SET status = 'voided', voided_at = NOW(),
        void_reason = 'Mig 361: 15m/1h durations dropped pre-launch',
        updated_at = NOW()
    WHERE id = v_market.id;

    v_voided_count := v_voided_count + 1;
  END LOOP;

  RAISE NOTICE 'Mig 361: voided % markets, refunded % positions', v_voided_count, v_refund_count;
END;
$$;
