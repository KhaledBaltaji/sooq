// GET /api/time — returns the server's current epoch ms.
//
// Used by `useServerTime` to compute clock-skew offset between user device
// and the Vercel/RDS authoritative clock, which lets every speed component's
// `secondsLeft` calc match what the server enforces. Fixes the 30s-skewed-
// clock case where users get locked out of (or get cryptic rejects on) trades
// that the server still considers in-window.
//
// Response is intentionally tiny (single number) so the round-trip is cheap;
// caller polls every 60s by default, on tab focus, on online event.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ serverTimeMs: Date.now() });
}
