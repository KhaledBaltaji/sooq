// GET /api/speed/markets — list speed markets with filters.
//   asset       — restrict to a single asset (e.g. BTC)
//   duration    — restrict to a single duration (5m / 15m / 24h)
//   status      — restrict to one status (open / resolving / resolved / voided)
//   since       — opens_at >= ISO timestamp
//   sort        — "asc" (default) | "desc" by opens_at
//   limit       — max rows (default 50, cap 200)
// Public endpoint. Polled by use-speed-markets, speed-window-pills,
// speed-recent-settlements.

import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedMarkets } from "@/lib/db/schema";

const STATUSES = ["open", "resolving", "resolved", "voided"] as const;
type SpeedStatus = (typeof STATUSES)[number];

const DURATIONS = ["5m", "15m", "24h"] as const;
type SpeedDuration = (typeof DURATIONS)[number];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset");
  const statusParam = url.searchParams.get("status");
  const durationParam = url.searchParams.get("duration");
  const sinceParam = url.searchParams.get("since");
  const sortParam = url.searchParams.get("sort") ?? "asc";

  const status: SpeedStatus | null =
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as SpeedStatus)
      : null;
  const duration: SpeedDuration | null =
    durationParam && (DURATIONS as readonly string[]).includes(durationParam)
      ? (durationParam as SpeedDuration)
      : null;
  const since = sinceParam ? new Date(sinceParam) : null;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "invalid `since`" }, { status: 400 });
  }
  const sort = sortParam === "desc" ? "desc" : "asc";

  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

  const conditions: SQL[] = [];
  if (asset) conditions.push(eq(speedMarkets.asset, asset));
  if (status) conditions.push(eq(speedMarkets.status, status));
  if (duration) conditions.push(eq(speedMarkets.duration, duration));
  if (since) conditions.push(gte(speedMarkets.opensAt, since));

  const rows = await db
    .select()
    .from(speedMarkets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sort === "desc" ? desc(speedMarkets.opensAt) : asc(speedMarkets.opensAt))
    .limit(limit);

  return NextResponse.json({
    markets: rows.map((m) => ({
      id: m.id,
      asset: m.asset,
      duration: m.duration,
      strike_price: m.strikePrice ? Number(m.strikePrice) : null,
      opens_at: m.opensAt.toISOString(),
      closes_at: m.closesAt.toISOString(),
      status: m.status,
      outcome: m.outcome,
      twap_at_close: m.twapAtClose ? Number(m.twapAtClose) : null,
      void_reason: m.voidReason,
      resolved_at: m.resolvedAt?.toISOString() ?? null,
      created_at: m.createdAt.toISOString(),
    })),
  });
}
