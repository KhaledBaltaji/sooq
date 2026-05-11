// GET /api/users/me — returns the signed-in user's profile in snake_case JSON.
//
// Drizzle internal types are camelCase; we convert at the API boundary so
// client components keep using snake_case (matches the legacy supabase-js
// response shape). Single point of conversion = no scattered casts in components.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { User as ApiUser } from "@/types/user";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const u = rows[0];
  if (!u) {
    return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  }

  const profile: ApiUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    email_verified: u.emailVerified ? u.emailVerified.toISOString() : null,
    image: u.image,
    phone: u.phone,
    display_name: u.displayName,
    avatar_url: u.avatarUrl,
    bio: u.bio,
    locale: u.locale,
    balance_usd: Number(u.balanceUsd),
    is_admin: u.isAdmin,
    is_frozen: u.isFrozen,
    admin_allowed_views: u.adminAllowedViews,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };

  return NextResponse.json(profile, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
