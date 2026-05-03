// POST /api/notifications/read-all — bulk mark all unread for the caller.

import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const r = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, session.user.id), isNull(notifications.readAt))
    )
    .returning({ id: notifications.id });

  return NextResponse.json({ marked: r.length });
  void sql; // keep type imports satisfied when bundler tree-shakes
}
