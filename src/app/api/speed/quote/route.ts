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
// All math runs server-side via PG helpers (_speed_get_iv,
// speed_fair_prob_over, _speed_seconds_left_bucket, _speed_cashout_margin).
// No JS duplication of pricing logic — the quote and execute paths see the
// SAME numbers because they call the SAME functions.
//
// Codex review fix: quote endpoint applies the same oracle freshness gate
// (speed_oracle_stale_seconds) as the execute RPCs. Without this, users
// could see a quote that the subsequent execute call rejects, generating
// CS disputes about "the price changed". The freshness check makes both
// paths reject for the same reason at the same time.

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
  offered_prob: number;
  payout_if_won: number;   // assumes stake=1 — client multiplies
  spread_mult: number;
  rejected: boolean;
  reject_reason: string | null;
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
  is_winning: boolean;
  fair_profit: number;
  margin_applied: number;
  cashout_amount: number;
  rejected: boolean;
  reject_reason: string | null;
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
                m.strike_price,
                m.duration,
                m.closes_at,
                m.status,
                o.price AS spot_price,
                o.received_at,
                EXTRACT(EPOCH FROM (m.closes_at - NOW()))::DOUBLE PRECISION AS seconds_left,
                _speed_get_iv(m.asset, m.duration) AS iv_used
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
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult'), 1.40) AS late_60s_mult,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult'), 1.80) AS late_30s_mult,
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
            offered AS (
              SELECT
                pr.*,
                LEAST(0.99, GREATEST(0.01,
                  (pr.fair_prob_side::DOUBLE PRECISION + pr.widened_spread / 2.0)
                ))::DECIMAL AS offered_prob,
                CASE
                  WHEN pr.status <> 'open' THEN 'Market is not open'
                  WHEN NOW() >= pr.closes_at THEN 'Market has closed'
                  WHEN EXTRACT(EPOCH FROM (NOW() - pr.received_at))
                       > COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds'), 2)
                    THEN 'Oracle price stale — try again'
                  WHEN pr.seconds_left < pr.late_reject_s THEN 'Market closing — no new bets'
                  WHEN pr.fair_prob_side > pr.reject_high THEN 'Outcome too close to certain'
                  WHEN pr.fair_prob_side < pr.reject_low THEN 'Side too unlikely'
                  WHEN pr.seconds_left < 30 AND ABS(pr.fair_prob_side::DOUBLE PRECISION - 0.5) > pr.late_30s_imb::DOUBLE PRECISION THEN 'Too late and too one-sided'
                  ELSE NULL
                END AS reject_reason
              FROM priced pr
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
            'offered_prob', ROUND(offered_prob, 6),
            'payout_if_won', ROUND(1.0 / offered_prob, 6),
            'spread_mult', ROUND(spread_mult::NUMERIC, 4),
            'rejected', reject_reason IS NOT NULL,
            'reject_reason', reject_reason
          )::jsonb AS result
          FROM offered
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
                pos.strike_price,
                pos.market_duration,
                pos.closes_at,
                ora.price AS spot_price,
                ora.received_at,
                EXTRACT(EPOCH FROM (pos.closes_at - NOW()))::DOUBLE PRECISION AS seconds_left,
                _speed_get_iv(pos.market_asset, pos.market_duration) AS iv_used
              FROM pos, ora
            ),
            fair AS (
              SELECT
                b.*,
                _speed_seconds_left_bucket(b.seconds_left) AS seconds_left_bucket,
                speed_fair_prob_over(b.spot_price, b.strike_price, b.seconds_left, b.iv_used) AS fair_prob_over
              FROM base b
            ),
            mark AS (
              SELECT
                f.*,
                CASE WHEN f.side::text = 'over'
                     THEN f.fair_prob_over
                     ELSE 1.0 - f.fair_prob_over
                END AS mark_prob
              FROM fair f
            ),
            cfg AS (
              SELECT
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s'), 10) AS late_reject_s,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject'), 0.30) AS late_30s_imb,
                COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_enabled'), 1) AS kill_switch
            ),
            priced AS (
              SELECT
                m.*,
                c.kill_switch,
                c.late_reject_s,
                c.late_30s_imb,
                (m.mark_prob > m.entry_offered_prob) AS is_winning,
                m.stake * (m.mark_prob / m.entry_offered_prob - 1.0) AS fair_profit
              FROM mark m, cfg c
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
                END AS cashout_raw
              FROM margins m
            ),
            final AS (
              SELECT
                c.*,
                ROUND(GREATEST(0, c.cashout_raw)::NUMERIC, 2) AS cashout_amount,
                CASE
                  WHEN c.kill_switch <= 0 THEN 'Cashout temporarily disabled'
                  WHEN c.position_status <> 'open' THEN 'Position is not open'
                  WHEN c.market_status <> 'open' THEN 'Market is not open'
                  WHEN NOW() >= c.closes_at THEN 'Market has closed'
                  WHEN EXTRACT(EPOCH FROM (NOW() - c.received_at))
                       > COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds'), 2)
                    THEN 'Oracle price stale — try again'
                  WHEN c.seconds_left < c.late_reject_s THEN 'Market closing — no cashouts'
                  WHEN c.seconds_left < 30 AND ABS(c.mark_prob::DOUBLE PRECISION - 0.5) > c.late_30s_imb::DOUBLE PRECISION THEN 'Too late and too one-sided'
                  ELSE NULL
                END AS reject_reason
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
            'mark_prob', ROUND(mark_prob, 6),
            'is_winning', is_winning,
            'fair_profit', ROUND(fair_profit, 4),
            'margin_applied', ROUND(margin::NUMERIC, 6),
            'cashout_amount', cashout_amount,
            'rejected', reject_reason IS NOT NULL,
            'reject_reason', reject_reason
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
