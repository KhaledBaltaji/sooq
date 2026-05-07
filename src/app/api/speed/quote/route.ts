// POST /api/speed/quote — read-only price quote for a speed market position.
//
// Companion to /api/speed/trade and /api/speed/cashout (mig 0030 parity).
// Returns the snapshot the client must echo back in expected_* params on
// the subsequent execute call. Quote/execute parity rejects the trade if
// any of these drifted between quote and execute beyond fee_config
// tolerances.
//
// Modes:
//   - "trade" mode: requires market_id + side. Returns offered_prob for
//     the requested side, fair_prob, spot, seconds_left_bucket, iv_used.
//   - "cashout" mode: requires position_id. Returns expected_mark_prob,
//     expected_cashout_amount, spot, seconds_left_bucket, iv_used. Uses
//     the position's stored entry_offered_prob to compute the same
//     option-C profit-based margin the cashout RPC will apply.
//
// 0034: pricing engine v3 — calls _speed_pricing_apply() for both modes so
// quote and execute see the SAME matrix-corrected number. Returns matrix_used,
// matrix_version, and soft_blocked so the client can render correctly without
// recomputing math locally.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { runAs } from "@/lib/db/run-as";
import { logger } from "@/lib/logger";

interface QuoteBody {
  mode: "trade" | "cashout";
  // trade mode
  market_id?: string;
  side?: "over" | "under";
  stake?: number;
  // cashout mode
  position_id?: string;
}

interface TradeQuote {
  mode: "trade";
  market_id: string;
  side: "over" | "under";
  spot_price: number;
  strike_price: number;
  seconds_left: number;
  seconds_left_bucket: number;
  iv_used: number;
  fair_prob_side: number;
  mark_prob: number;
  offered_prob: number;
  payout_if_won: number;   // assumes stake=1 — client multiplies
  spread_mult: number;
  matrix_used: boolean;
  matrix_version: number | null;
  soft_blocked: boolean;
  /** Mig 0035: true when offered would trip the late-30s near-decided rejector. Hint for UI to show "trade closing soon" before the actual block fires. */
  near_decided_block: boolean;
  /** Mig 0035: true when entry is fully blocked because seconds_left < late_window_reject_s. */
  late_window_block: boolean;
  max_stake_allowed: number;
  rejected: boolean;
  reject_reason: string | null;
  reject_code: string | null;
}

interface CashoutQuote {
  mode: "cashout";
  position_id: string;
  market_id: string;
  side: "over" | "under";
  stake: number;
  entry_offered_prob: number;
  spot_price: number;
  strike_price: number;
  seconds_left: number;
  seconds_left_bucket: number;
  iv_used: number;
  mark_prob: number;
  matrix_used: boolean;
  matrix_version: number | null;
  is_winning: boolean;
  fair_profit: number;
  margin_applied: number;
  cashout_amount: number;
  cap_edge: boolean;
  expected_settlement_payout: number;
  /** Mig 0035: true when mark would trip the late-30s near-decided cashout block. */
  near_decided_block: boolean;
  /** Mig 0035: true when cashout is fully blocked because seconds_left < cashout_late_reject_s. */
  late_window_block: boolean;
  rejected: boolean;
  reject_reason: string | null;
  reject_code: string | null;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as QuoteBody;

    if (body.mode === "trade") {
      if (!body.market_id || !body.side) {
        return NextResponse.json(
          { error: "Missing required fields: market_id, side" },
          { status: 400 }
        );
      }
      if (body.side !== "over" && body.side !== "under") {
        return NextResponse.json({ error: "Invalid side" }, { status: 400 });
      }

      const data = await runAs(session.user.id, async (tx) => {
        const r = await tx.execute<{ result: TradeQuote }>(sql`
          WITH
            mkt AS (
              SELECT id, asset, duration, strike_price, opens_at, closes_at, status
              FROM speed_markets WHERE id = ${body.market_id}::uuid
            ),
            ora AS (
              SELECT o.price, o.received_at
              FROM speed_oracle_latest o
              JOIN mkt m ON m.asset = o.asset
            ),
            base AS (
              SELECT
                m.id AS market_id,
                m.asset,
                m.strike_price,
                m.duration,
                m.closes_at,
                m.status,
                o.price AS spot_price,
                o.received_at,
                EXTRACT(EPOCH FROM (m.closes_at - NOW()))::DOUBLE PRECISION AS seconds_left,
                _speed_get_iv(m.asset, m.duration) AS iv_used,
                (o.price::DOUBLE PRECISION - m.strike_price::DOUBLE PRECISION)
                  / NULLIF(m.strike_price::DOUBLE PRECISION, 0) AS dist_pct
              FROM mkt m, ora o
            ),
            fair AS (
              SELECT
                b.*,
                _speed_seconds_left_bucket(b.seconds_left) AS seconds_left_bucket,
                speed_fair_prob_over(b.spot_price, b.strike_price, b.seconds_left, b.iv_used) AS fair_prob_over
              FROM base b
            ),
            sides AS (
              SELECT
                f.*,
                CASE WHEN ${body.side}::text = 'over'
                     THEN f.fair_prob_over
                     ELSE 1.0 - f.fair_prob_over
                END AS fair_prob_side
              FROM fair f
            ),
            cfg AS (
              SELECT
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_spread_pct'), 0.05) AS spread_pct,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff'), 8) AS extreme_coeff,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult'), 1.20) AS late_60s_mult,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult'), 1.40) AS late_30s_mult,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_high'), 0.97) AS reject_high,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_low'), 0.03) AS reject_low,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject'), 0.30) AS late_30s_imb,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_window_reject_s'), 10) AS late_reject_s
            ),
            spread AS (
              SELECT
                s.*,
                c.spread_pct,
                c.reject_high,
                c.reject_low,
                c.late_30s_imb,
                c.late_reject_s,
                CASE
                  WHEN s.seconds_left < 30 THEN c.late_30s_mult::DOUBLE PRECISION
                  WHEN s.seconds_left < 60 THEN c.late_60s_mult::DOUBLE PRECISION
                  ELSE 1.0
                END AS spread_mult,
                GREATEST(0.0, ABS(s.fair_prob_side::DOUBLE PRECISION - 0.5) - 0.45) AS overage,
                ABS(s.fair_prob_side::DOUBLE PRECISION - 0.5) AS distance,
                c.extreme_coeff
              FROM sides s, cfg c
            ),
            priced AS (
              SELECT
                p.*,
                (p.spread_pct::DOUBLE PRECISION + p.overage * p.overage * p.extreme_coeff::DOUBLE PRECISION) * p.spread_mult AS widened_spread
              FROM spread p
            ),
            applied AS (
              -- 0034: shared helper for matrix correction + asym push-up + soft-block
              SELECT
                pr.*,
                a.mark_prob,
                a.offered_prob,
                a.matrix_used,
                a.matrix_version,
                a.soft_blocked
              FROM priced pr
              CROSS JOIN LATERAL _speed_pricing_apply(
                pr.asset,
                pr.duration,
                ${body.side}::text,
                pr.dist_pct,
                pr.seconds_left,
                pr.fair_prob_side::DOUBLE PRECISION,
                pr.widened_spread,
                'entry'::text
              ) a
            ),
            stake_max AS (
              SELECT
                ap.*,
                _speed_max_stake_for_offered(ap.duration, ap.offered_prob) AS max_stake_allowed
              FROM applied ap
            ),
            final AS (
              SELECT
                sm.*,
                -- Mig 0035: separately exposed boolean blocks for UI hint logic
                (sm.seconds_left < sm.late_reject_s) AS late_window_block,
                (sm.seconds_left < 30
                  AND ABS(sm.fair_prob_side::DOUBLE PRECISION - 0.5) > sm.late_30s_imb::DOUBLE PRECISION) AS near_decided_block,
                CASE
                  WHEN sm.status <> 'open' THEN ('Market is not open'::text, 'MARKET_CLOSED'::text)
                  WHEN NOW() >= sm.closes_at THEN ('Market has closed', 'MARKET_CLOSED')
                  WHEN EXTRACT(EPOCH FROM (NOW() - sm.received_at))
                       > COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds'), 2)
                    THEN ('Oracle price stale — try again', 'ORACLE_STALE')
                  WHEN sm.seconds_left < sm.late_reject_s THEN ('Market closing — no new bets', 'LATE_WINDOW')
                  WHEN sm.fair_prob_side > sm.reject_high THEN ('Outcome too close to certain', 'FAIR_PROB_TOO_HIGH')
                  WHEN sm.fair_prob_side < sm.reject_low THEN ('Side too unlikely', 'FAIR_PROB_TOO_LOW')
                  WHEN sm.seconds_left < 30 AND ABS(sm.fair_prob_side::DOUBLE PRECISION - 0.5) > sm.late_30s_imb::DOUBLE PRECISION
                    THEN ('Too late and too one-sided', 'LATE_30S_IMBALANCE')
                  WHEN sm.soft_blocked THEN ('Market closing — try next round', 'SOFT_BLOCK')
                  ELSE (NULL, NULL)
                END AS reject_tuple
              FROM stake_max sm
            )
          SELECT jsonb_build_object(
            'mode', 'trade',
            'market_id', ${body.market_id}::uuid,
            'side', ${body.side}::text,
            'spot_price', ROUND(spot_price, 8),
            'strike_price', ROUND(strike_price, 8),
            'seconds_left', ROUND(seconds_left::NUMERIC, 2),
            'seconds_left_bucket', seconds_left_bucket,
            'iv_used', ROUND(iv_used, 6),
            'fair_prob_side', ROUND(fair_prob_side, 6),
            'mark_prob', ROUND(mark_prob::NUMERIC, 6),
            'offered_prob', ROUND(offered_prob::NUMERIC, 6),
            'payout_if_won', ROUND((1.0 / offered_prob)::NUMERIC, 6),
            'spread_mult', ROUND(spread_mult::NUMERIC, 4),
            'matrix_used', matrix_used,
            'matrix_version', matrix_version,
            'soft_blocked', soft_blocked,
            'near_decided_block', near_decided_block,
            'late_window_block', late_window_block,
            'max_stake_allowed', ROUND(max_stake_allowed::NUMERIC, 2),
            'rejected', (reject_tuple).f1 IS NOT NULL,
            'reject_reason', (reject_tuple).f1,
            'reject_code', (reject_tuple).f2
          )::jsonb AS result
          FROM final
        `);
        return (r.rows[0] as { result: TradeQuote } | undefined)?.result ?? null;
      });

      if (!data) {
        return NextResponse.json({ error: "Quote unavailable (market or oracle missing)" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    if (body.mode === "cashout") {
      if (!body.position_id) {
        return NextResponse.json({ error: "Missing position_id" }, { status: 400 });
      }

      const data = await runAs(session.user.id, async (tx) => {
        const r = await tx.execute<{ result: CashoutQuote }>(sql`
          WITH
            pos AS (
              SELECT p.*, m.asset AS market_asset, m.duration AS market_duration,
                     m.strike_price, m.opens_at, m.closes_at, m.status AS market_status
              FROM speed_positions p
              JOIN speed_markets m ON m.id = p.market_id
              WHERE p.id = ${body.position_id}::uuid
            ),
            ora AS (
              SELECT o.price, o.received_at
              FROM speed_oracle_latest o, pos
              WHERE o.asset = pos.market_asset
            ),
            base AS (
              SELECT
                pos.id AS position_id,
                pos.market_id,
                pos.user_id,
                pos.side,
                pos.stake,
                pos.entry_offered_prob,
                pos.status AS position_status,
                pos.market_status,
                pos.market_asset,
                pos.strike_price,
                pos.market_duration,
                pos.closes_at,
                ora.price AS spot_price,
                ora.received_at,
                EXTRACT(EPOCH FROM (pos.closes_at - NOW()))::DOUBLE PRECISION AS seconds_left,
                _speed_get_iv(pos.market_asset, pos.market_duration) AS iv_used,
                (ora.price::DOUBLE PRECISION - pos.strike_price::DOUBLE PRECISION)
                  / NULLIF(pos.strike_price::DOUBLE PRECISION, 0) AS dist_pct
              FROM pos, ora
            ),
            fair AS (
              SELECT
                b.*,
                _speed_seconds_left_bucket(b.seconds_left) AS seconds_left_bucket,
                speed_fair_prob_over(b.spot_price, b.strike_price, b.seconds_left, b.iv_used) AS fair_prob_over
              FROM base b
            ),
            sides AS (
              SELECT
                f.*,
                CASE WHEN f.side::text = 'over'
                     THEN f.fair_prob_over
                     ELSE 1.0 - f.fair_prob_over
                END AS bsm_mark_side
              FROM fair f
            ),
            applied AS (
              -- 0034: shared helper for matrix-corrected mark (cashout mode, no spread)
              SELECT
                s.*,
                a.mark_prob,
                a.matrix_used,
                a.matrix_version
              FROM sides s
              CROSS JOIN LATERAL _speed_pricing_apply(
                s.market_asset,
                s.market_duration,
                s.side::text,
                s.dist_pct,
                s.seconds_left,
                s.bsm_mark_side,
                0::DOUBLE PRECISION,
                'cashout'::text
              ) a
            ),
            cfg AS (
              SELECT
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s'), 10) AS late_reject_s,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject'), 0.30) AS late_30s_imb,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_enabled'), 1) AS kill_switch,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_cap_edge_threshold'), 0.985) AS cap_edge_thresh
            ),
            priced AS (
              SELECT
                a.*,
                c.kill_switch,
                c.late_reject_s,
                c.late_30s_imb,
                c.cap_edge_thresh,
                (a.mark_prob > a.entry_offered_prob) AS is_winning,
                a.stake * (a.mark_prob / a.entry_offered_prob - 1.0) AS fair_profit,
                (a.entry_offered_prob >= c.cap_edge_thresh AND a.mark_prob >= c.cap_edge_thresh) AS cap_edge
              FROM applied a, cfg c
            ),
            margins AS (
              SELECT
                p.*,
                _speed_cashout_margin(
                  p.market_duration,
                  p.is_winning,
                  p.mark_prob,
                  p.seconds_left
                ) AS margin
              FROM priced p
            ),
            cashout AS (
              SELECT
                m.*,
                CASE
                  WHEN m.is_winning THEN m.stake + m.fair_profit * (1.0 - m.margin)
                  ELSE m.stake + m.fair_profit * (1.0 + m.margin)
                END AS cashout_raw,
                m.stake / m.entry_offered_prob AS expected_settlement_payout
              FROM margins m
            ),
            final AS (
              SELECT
                c.*,
                ROUND(GREATEST(0, c.cashout_raw)::NUMERIC, 2) AS cashout_amount,
                -- Mig 0035: separately exposed boolean blocks for UI hint logic
                (c.seconds_left < c.late_reject_s) AS late_window_block,
                (c.seconds_left < 30
                  AND ABS(c.mark_prob::DOUBLE PRECISION - 0.5) > c.late_30s_imb::DOUBLE PRECISION) AS near_decided_block,
                CASE
                  WHEN c.kill_switch <= 0 THEN ('Cashout temporarily disabled'::text, 'CASHOUT_DISABLED'::text)
                  WHEN c.position_status <> 'open' THEN ('Position is not open', 'POSITION_CLOSED')
                  WHEN c.market_status <> 'open' THEN ('Market is not open', 'MARKET_CLOSED')
                  WHEN NOW() >= c.closes_at THEN ('Market has closed', 'MARKET_CLOSED')
                  WHEN EXTRACT(EPOCH FROM (NOW() - c.received_at))
                       > COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds'), 2)
                    THEN ('Oracle price stale — try again', 'ORACLE_STALE')
                  WHEN c.cap_edge THEN ('Hold to settlement', 'CASHOUT_AT_CAP')
                  WHEN c.seconds_left < c.late_reject_s THEN ('Market closing — no cashouts', 'LATE_WINDOW')
                  WHEN c.seconds_left < 30 AND ABS(c.mark_prob::DOUBLE PRECISION - 0.5) > c.late_30s_imb::DOUBLE PRECISION
                    THEN ('Too late and too one-sided', 'LATE_30S_IMBALANCE')
                  ELSE (NULL, NULL)
                END AS reject_tuple
              FROM cashout c
            )
          SELECT jsonb_build_object(
            'mode', 'cashout',
            'position_id', position_id,
            'market_id', market_id,
            'side', side::text,
            'stake', ROUND(stake, 2),
            'entry_offered_prob', ROUND(entry_offered_prob, 6),
            'spot_price', ROUND(spot_price, 8),
            'strike_price', ROUND(strike_price, 8),
            'seconds_left', ROUND(seconds_left::NUMERIC, 2),
            'seconds_left_bucket', seconds_left_bucket,
            'iv_used', ROUND(iv_used, 6),
            'mark_prob', ROUND(mark_prob::NUMERIC, 6),
            'matrix_used', matrix_used,
            'matrix_version', matrix_version,
            'is_winning', is_winning,
            'fair_profit', ROUND(fair_profit::NUMERIC, 4),
            'margin_applied', ROUND(margin::NUMERIC, 6),
            'cashout_amount', cashout_amount,
            'cap_edge', cap_edge,
            'expected_settlement_payout', ROUND(expected_settlement_payout::NUMERIC, 2),
            'near_decided_block', near_decided_block,
            'late_window_block', late_window_block,
            'rejected', (reject_tuple).f1 IS NOT NULL,
            'reject_reason', (reject_tuple).f1,
            'reject_code', (reject_tuple).f2
          )::jsonb AS result
          FROM final
        `);
        return (r.rows[0] as { result: CashoutQuote } | undefined)?.result ?? null;
      });

      if (!data) {
        return NextResponse.json({ error: "Quote unavailable (position not found)" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal error";
    logger.error("speed_quote failed", { source: "api/speed/quote", errorMessage }, err);
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
