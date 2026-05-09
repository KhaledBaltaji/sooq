// GET /api/admin/stats/money-summary?from=&to=
//
// Phase 5K — Money tab data source. Returns aggregate flows over the
// time range plus current point-in-time totals. All values in USD.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

interface MoneyKpiRow {
  deposits_in: string | null;
  withdrawals_out: string | null;
  withdrawal_fees: string | null;
  total_balance_held: string | null;
  [key: string]: unknown;
}

interface PendingWithdrawalRow {
  id: string;
  user_email: string | null;
  amount: string;
  fee_amount: string | null;
  method: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

interface RecentDepositRow {
  id: string;
  user_email: string | null;
  amount: string;
  status: string;
  currency: string | null;
  provider: string | null;
  created_at: string;
  [key: string]: unknown;
}

export async function GET(req: Request) {
  try {
    await requireAdminApi();
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam ? new Date(fromParam) : null;
    const to = toParam ? new Date(toParam) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const fromIso = from ? from.toISOString() : null;
    const toIso = to ? to.toISOString() : null;

    // KPIs in one round-trip. Deposits from `deposits` (status verified)
    // and withdrawals from `withdrawals` (status sent) — gives us the
    // canonical "money in" / "money out" instead of relying on ledger
    // sign conventions. Balance held is point-in-time.
    const kpiResult = await db.execute<MoneyKpiRow>(sql`
      SELECT
        (SELECT COALESCE(SUM(amount), 0)::text
           FROM deposits
          WHERE status = 'verified'
            AND (${fromIso}::timestamptz IS NULL OR created_at >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR created_at <= ${toIso}::timestamptz)
        ) AS deposits_in,
        (SELECT COALESCE(SUM(amount), 0)::text
           FROM withdrawals
          WHERE status = 'sent'
            AND (${fromIso}::timestamptz IS NULL OR sent_at >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR sent_at <= ${toIso}::timestamptz)
        ) AS withdrawals_out,
        (SELECT COALESCE(SUM(fee_amount), 0)::text
           FROM withdrawals
          WHERE status = 'sent'
            AND (${fromIso}::timestamptz IS NULL OR sent_at >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR sent_at <= ${toIso}::timestamptz)
        ) AS withdrawal_fees,
        (SELECT COALESCE(SUM(balance_usd), 0)::text FROM users) AS total_balance_held
    `);
    const k = kpiResult.rows[0];

    // Top 10 pending withdrawals (status IN pending/approved — not yet sent)
    const pendingResult = await db.execute<PendingWithdrawalRow>(sql`
      SELECT
        w.id::text AS id,
        u.email AS user_email,
        w.amount::text AS amount,
        w.fee_amount::text AS fee_amount,
        w.method,
        w.status::text AS status,
        w.created_at::text AS created_at
      FROM withdrawals w
      LEFT JOIN users u ON u.id = w.user_id
      WHERE w.status IN ('pending', 'approved')
      ORDER BY w.amount DESC
      LIMIT 10
    `);

    // Last 20 deposits across all statuses
    const depositsResult = await db.execute<RecentDepositRow>(sql`
      SELECT
        d.id::text AS id,
        u.email AS user_email,
        d.amount::text AS amount,
        d.status::text AS status,
        d.currency,
        d.provider,
        d.created_at::text AS created_at
      FROM deposits d
      LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.created_at DESC
      LIMIT 20
    `);

    return NextResponse.json({
      kpi: {
        deposits_in: Number(k?.deposits_in ?? 0),
        withdrawals_out: Number(k?.withdrawals_out ?? 0),
        withdrawal_fees: Number(k?.withdrawal_fees ?? 0),
        total_balance_held: Number(k?.total_balance_held ?? 0),
      },
      pending_withdrawals: pendingResult.rows.map((r) => ({
        id: r.id,
        user_email: r.user_email,
        amount: Number(r.amount),
        fee_amount: r.fee_amount === null ? null : Number(r.fee_amount),
        method: r.method,
        status: r.status,
        created_at: r.created_at,
      })),
      recent_deposits: depositsResult.rows.map((r) => ({
        id: r.id,
        user_email: r.user_email,
        amount: Number(r.amount),
        status: r.status,
        currency: r.currency,
        provider: r.provider,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
