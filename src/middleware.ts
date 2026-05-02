// Edge middleware — rate limiting + admin route gating only.
//
// Auth session check happens in:
//   - Page-level Server Components via `auth()` from @/auth
//   - API routes via `auth()` from @/auth or session cookie inspection
//
// Middleware stays Edge-light: no DB calls, no Auth.js DB adapter calls
// (DrizzleAdapter requires Node runtime). The admin layout does the
// is_admin check + admin_allowed_views enforcement now.

import { type NextRequest, NextResponse } from "next/server";
import { isRateLimited, getRateLimitConfig } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Coming-soon mode (env-gated) — let /auth/* through for OAuth callbacks.
  if (process.env.COMING_SOON === "true") {
    if (
      path !== "/coming-soon" &&
      !path.startsWith("/api/") &&
      !path.startsWith("/_next/") &&
      !path.startsWith("/auth/")
    ) {
      return NextResponse.redirect(new URL("/coming-soon", request.url));
    }
  }

  // Rate limiting for API routes (in-memory per-Edge-region).
  const rateLimitConfig = getRateLimitConfig(path);
  if (rateLimitConfig) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (
      isRateLimited(
        ip,
        path,
        rateLimitConfig.limit,
        rateLimitConfig.windowMs
      )
    ) {
      logger.warn(`Rate limited: ${request.method} ${path}`, {
        source: "http/429",
        ip,
        path,
        method: request.method,
      });
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip _next assets, favicon, public images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
