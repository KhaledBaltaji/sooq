// POST /api/notifications/[id]/read — mark a single notification read.
// Idempotent: sets read_at = now() if not already set; only allows the
// caller to mark their own notifications.

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id, readAt: notifications.readAt });

  return NextResponse.json({
    id,
    read_at: updated[0]?.readAt?.toISOString() ?? null,
    already_read: updated.length === 0,
  });
}
