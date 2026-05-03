// PATCH /api/users/profile — update editable user profile fields.
// Only allows display_name, bio, locale, avatar_url to be set.
// Auth.js does not own the users row directly — it's the app's source of
// truth. We update via Drizzle.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

interface ProfileBody {
  display_name?: string | null;
  bio?: string | null;
  locale?: string;
  avatar_url?: string | null;
}

const ALLOWED_LOCALES = new Set(["en", "ar"]);

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ProfileBody;

  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

  if (body.display_name !== undefined) {
    if (body.display_name && body.display_name.length > 80) {
      return NextResponse.json({ error: "display_name too long" }, { status: 400 });
    }
    update.displayName = body.display_name ?? null;
  }
  if (body.bio !== undefined) {
    if (body.bio && body.bio.length > 500) {
      return NextResponse.json({ error: "bio too long" }, { status: 400 });
    }
    update.bio = body.bio ?? null;
  }
  if (body.locale !== undefined) {
    if (!ALLOWED_LOCALES.has(body.locale)) {
      return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
    }
    update.locale = body.locale;
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && body.avatar_url.length > 500) {
      return NextResponse.json({ error: "avatar_url too long" }, { status: 400 });
    }
    update.avatarUrl = body.avatar_url ?? null;
  }

  const updated = await db
    .update(users)
    .set(update)
    .where(eq(users.id, session.user.id))
    .returning({
      id: users.id,
      display_name: users.displayName,
      bio: users.bio,
      locale: users.locale,
      avatar_url: users.avatarUrl,
      updated_at: users.updatedAt,
    });

  if (!updated[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const u = updated[0];
  return NextResponse.json({
    id: u.id,
    display_name: u.display_name,
    bio: u.bio,
    locale: u.locale,
    avatar_url: u.avatar_url,
    updated_at: u.updated_at?.toISOString() ?? null,
  });
}
