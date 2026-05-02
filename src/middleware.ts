import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";
import { isRateLimited, getRateLimitConfig } from "@/lib/rate-limit";
import { persistToSystemLogs } from "@/lib/logger";
import { getViewKeyFromPathname, getFirstAllowedPath, canAccessView } from "@/lib/admin-views";

export async function middleware(request: NextRequest) {
  // Coming soon mode: redirect all non-API, non-asset routes to /coming-soon
  // /auth/* must pass through so Google OAuth can complete (returns to /auth/callback)
  if (process.env.COMING_SOON === "true") {
    const path = request.nextUrl.pathname;
    if (
      path !== "/coming-soon" &&
      !path.startsWith("/api/") &&
      !path.startsWith("/_next/") &&
      !path.startsWith("/auth/")
    ) {
      return NextResponse.redirect(new URL("/coming-soon", request.url));
    }
  }

  // Prelaunch mode: gate the entire app behind shu-rayak
  // /auth/* must pass through so Google OAuth can complete (returns to /auth/callback)
  if (process.env.NEXT_PUBLIC_PRELAUNCH === "true") {
    const path = request.nextUrl.pathname;
    if (
      path !== "/shu-rayak" &&
      !path.startsWith("/api/") &&
      !path.startsWith("/_next/") &&
      !path.startsWith("/auth/")
    ) {
      return NextResponse.redirect(new URL("/shu-rayak", request.url));
    }
  }

  // Rate limiting for API routes
  const rateLimitConfig = getRateLimitConfig(request.nextUrl.pathname);
  if (rateLimitConfig) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";

    if (isRateLimited(ip, request.nextUrl.pathname, rateLimitConfig.limit, rateLimitConfig.windowMs)) {
      persistToSystemLogs("error", `Rate limited: ${request.method} ${request.nextUrl.pathname}`, {
        source: "http/429",
        ip,
        path: request.nextUrl.pathname,
        method: request.method,
      });
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  // Skip auth refresh for public pages (saves ~100-200ms per navigation)
  const path = request.nextUrl.pathname;

  // Public API paths that don't need auth session refresh (use their own auth: secrets, CRON_SECRET, etc.)
  const isPublicApi =
    path.startsWith("/api/health") ||
    path.startsWith("/api/og") ||
    path.startsWith("/api/webhook") ||
    path.startsWith("/api/cron");

  const isPublicPage =
    path === "/" ||
    path === "/markets" ||
    path.startsWith("/market/") ||
    path.startsWith("/m/") ||
    path === "/help" ||
    path === "/coming-soon" ||
    path === "/shu-rayak" ||
    isPublicApi;

  // /b/ routes are public (viewable without auth) but need session refresh for trading
  if (path.startsWith("/b/")) {
    return await updateSession(request);
  }

  if (isPublicPage) {
    return NextResponse.next();
  }

  // Admin per-page view enforcement for sub-admins
  if (path.startsWith("/admin")) {
    const response = await updateSession(request);
    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return request.cookies.getAll(); },
            setAll() { /* read-only — cookies already handled by updateSession */ },
          },
        }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("is_admin, admin_allowed_views")
          .eq("id", user.id)
          .single();

        if (profile?.is_admin && profile.admin_allowed_views && profile.admin_allowed_views.length > 0) {
          const viewKey = getViewKeyFromPathname(path);
          // "admins" page is super-admin only
          if (viewKey === "admins" || !canAccessView(profile.admin_allowed_views, viewKey)) {
            const redirectPath = getFirstAllowedPath(profile.admin_allowed_views);
            return NextResponse.redirect(new URL(redirectPath, request.url));
          }
        }
      }
    } catch {
      // If view check fails, fall through — layout guard handles the rest
    }
    return response;
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
