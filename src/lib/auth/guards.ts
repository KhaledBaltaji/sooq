// Server-side auth guards backed by Auth.js v5.
//
// Use these in Server Components or API routes:
//   const session = await requireAuth();        // redirects to /login if no session
//   const { user, allowedViews } = await requireAdmin();  // redirects if not admin

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Require any authenticated session. Redirects to /login if missing.
 * Returns the Auth.js session.user object — has id, name, email, image.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
}

/**
 * Require an admin session. Redirects to /login if no session, to /
 * if signed in but not admin. Returns the user + their allowed admin views.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const rows = await db
    .select({
      isAdmin: users.isAdmin,
      adminAllowedViews: users.adminAllowedViews,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const profile = rows[0];
  if (!profile?.isAdmin) {
    redirect("/");
  }

  return {
    user: session.user,
    allowedViews: profile.adminAllowedViews ?? null,
  };
}
