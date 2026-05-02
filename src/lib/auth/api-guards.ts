// JSON-friendly auth guards for API routes.
//
// `requireAuth()` and `requireAdmin()` in ./guards.ts are for Server
// Components — they redirect on failure, which is the wrong behaviour
// in a JSON API. These helpers throw a Response object instead, which
// the route catches and returns directly.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUserApi(): Promise<{ id: string; isAdmin: boolean }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new AuthError(401, "Unauthorized");
  }
  const rows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { id: userId, isAdmin: Boolean(rows[0]?.isAdmin) };
}

export async function requireAdminApi(): Promise<{ id: string }> {
  const u = await requireUserApi();
  if (!u.isAdmin) {
    throw new AuthError(403, "Forbidden — admin only");
  }
  return { id: u.id };
}

/** Convenience wrapper — turns AuthError into a JSON response. */
export function authErrorToResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
