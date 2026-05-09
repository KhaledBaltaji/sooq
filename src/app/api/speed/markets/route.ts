// GET /api/speed/markets — list speed markets with filters.
//   asset       — restrict to a single asset (e.g. BTC)
//   duration    — restrict to a single duration (5m / 1h)
//   status      — restrict to one status (open / resolving / resolved / voided)
//   since       — opens_at >= ISO timestamp
//   sort        — "asc" (default) | "desc" by opens_at
//   limit       — max rows (default 50, cap 200)
// Public endpoint. Polled by use-speed-markets, speed-window-pills.
//
// Mig 0028+: durations are 5m + 1h only. 15m and 24h were removed in mig 361 +
// mig 363; the trade RPC explicitly rejects them. Historical markets keep
// their enum value but new ones aren't created.

import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, notInArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedMarkets } from "@/lib/db/schema";

const STATUSES = ["open", "resolving", "resolved", "voided"] as const;
type SpeedStatus = (typeof STATUSES)[number];

// Phase 5B (mig 0046+0052): 1m + 5m active. 1h kept for legacy market display only
// (mig 0040 stopped opening new 1h markets but historical positions still resolve).
const DURATIONS = ["5m", "1m", "1h"] as const;
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
  // Mig 0028+: hide stale 15m / 24h rows from the public feed. The enum on
  // staging RDS still has those values (never removed because Postgres
  // doesn't support enum value removal without a full rewrite, and
  // historical positions FK-reference them) but they're no longer valid
  // active rounds. NOT IN keeps the query enum-safe regardless of which
  // values are in the active set.
  if (duration) {
    conditions.push(eq(speedMarkets.duration, duration));
  } else {
    conditions.push(notInArray(speedMarkets.duration, ["15m", "24h"]));
  }
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
