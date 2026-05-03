// GET /api/balance-history — series of (timestamp, balance) points for a chart.
//
// W2/W3 strip: the `trades` and `amm_state` tables are gone. Balance history
// is now reconstructed from `transactions.balance_after` only. Each row
// already carries the post-balance, so no aggregation needed — just project
// (created_at, balance_after) into a series, optionally bucketed.

import { NextResponse } from "next/server";
import { asc, eq, gte } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { and } from "drizzle-orm";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  // Default range: last 30 days. Caller can pass `since` (ISO) to override.
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "invalid `since`" }, { status: 400 });
  }

  const rows = await db
    .select({
      ts: transactions.createdAt,
      balance: transactions.balanceAfter,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, session.user.id),
        gte(transactions.createdAt, since)
      )
    )
    .orderBy(asc(transactions.createdAt));

  return NextResponse.json({
    points: rows.map((r) => ({
      ts: r.ts.toISOString(),
      balance: Number(r.balance),
    })),
  });
}
