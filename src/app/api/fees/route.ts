// GET /api/fees — public read of fee_config (no auth needed; rates are
// non-sensitive). Used by the withdraw form preview, speed-fee-config
// hooks, etc.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feeConfig } from "@/lib/db/schema";

export async function GET() {
  const rows = await db.select().from(feeConfig);

  // Map to legacy shape used by `lib/query/fees/queries.ts` consumers.
  const out = rows.map((f) => ({
    fee_type: f.feeType,
    rate: Number(f.rate),
    description: f.description,
  }));

  return NextResponse.json({ fees: out });
}
