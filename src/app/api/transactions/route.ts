// GET /api/transactions — current user's ledger entries, newest first.
//
// Replaces the direct supabase.from("transactions") read in
// src/hooks/use-transactions.ts. Polling cadence on the client is 5s.

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, session.user.id))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);

  return NextResponse.json(
    {
      transactions: rows.map((t) => ({
        id: t.id,
        user_id: t.userId,
        type: t.type,
        amount: Number(t.amount),
        balance_after: Number(t.balanceAfter),
        reference_id: t.referenceId,
        description: t.description,
        performed_by: t.performedBy,
        created_at: t.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" } },
  );
}
