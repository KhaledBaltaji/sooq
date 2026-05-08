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

/**
 * Allow either an authenticated admin OR a request carrying a valid
 * `x-monitor-token` header matching `process.env.HEALTH_MONITOR_TOKEN`.
 *
 * Used by /api/health/* endpoints (S0.6 mig 0038): these used to be public
 * and leaked oracle prices, ledger drift counts, and cron schedules. They
 * are now gated. External monitors (GitHub Actions, uptime probes) pass
 * the bearer token; admins reading via browser pass session.
 *
 * Throws AuthError with appropriate status when neither succeeds.
 */
export async function requireAdminOrMonitorToken(req: Request): Promise<void> {
  const monitorToken = process.env.HEALTH_MONITOR_TOKEN;
  const headerToken = req.headers.get("x-monitor-token");
  if (monitorToken && headerToken && headerToken === monitorToken) {
    return;
  }
  // Fall through to admin session check.
  await requireAdminApi();
}
