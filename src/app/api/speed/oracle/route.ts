// GET /api/speed/oracle — latest oracle price per asset. Public.
// Used by the live tail of the speed market chart + trade panel.
// Polled at 2s.
//
// Hotfix (2026-05-06): also return server-computed `age_ms` per row and
// `server_time_ms` for the envelope. The client previously did
// `Date.now() - received_at` to compute age, but `received_at` is server
// clock and `Date.now()` is device clock — any clock skew on the user's
// device produced a permanently-stale "Reconnecting" banner. Now the
// server does the math in its own clock and the client just uses the
// pre-computed delta.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedOracleLatest } from "@/lib/db/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset");

  const query = db.select().from(speedOracleLatest);
  const rows = asset
    ? await query.where(eq(speedOracleLatest.asset, asset))
    : await query;

  const nowMs = Date.now();

  return NextResponse.json({
    server_time_ms: nowMs,
    oracle: rows.map((r) => {
      const receivedAtMs = r.receivedAt.getTime();
      return {
        asset: r.asset,
        price: Number(r.price),
        received_at: r.receivedAt.toISOString(),
        // Server-computed age in milliseconds. Client uses this directly
        // instead of subtracting `received_at` from `Date.now()`, which
        // breaks under device clock skew.
        age_ms: nowMs - receivedAtMs,
      };
    }),
  });
}
