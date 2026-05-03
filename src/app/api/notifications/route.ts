// GET /api/notifications — current user's notifications, newest first.
//
// Replaces the direct supabase.from("notifications") read in
// notification-dropdown.tsx + (app)/notifications/page.tsx.

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, session.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  // Match the snake_case shape the existing components consume.
  const out = rows.map((n) => ({
    id: n.id,
    user_id: n.userId,
    type: n.type,
    title_en: n.titleEn,
    title_ar: n.titleAr,
    body_en: n.bodyEn,
    body_ar: n.bodyAr,
    reference_id: n.referenceId,
    read_at: n.readAt?.toISOString() ?? null,
    created_at: n.createdAt.toISOString(),
  }));

  return NextResponse.json({ notifications: out });
}
