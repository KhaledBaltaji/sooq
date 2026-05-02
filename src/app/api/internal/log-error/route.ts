import { NextRequest, NextResponse } from "next/server";
import { persistToSystemLogs } from "@/lib/logger";

// Simple in-memory rate limiter: max 30 requests per IP per 60 seconds
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 30;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/**
 * Internal endpoint for client-side error reporting.
 * Called by Sentry's beforeSend hook on the client to persist
 * unhandled errors to system_logs for admin dashboard visibility.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "unknown";

    if (isRateLimited(ip)) {
      return new NextResponse(null, { status: 429 });
    }

    const body = await req.json();
    const message = String(body.message || "Client error").slice(0, 1000);
    const source = String(body.source || "client");
    const context = typeof body.context === "object" && body.context ? body.context : {};

    persistToSystemLogs("error", message, { ...context, source });

    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
