/**
 * Simple in-memory sliding window rate limiter.
 * No Redis needed — suitable for single-instance Vercel deployments.
 * Each Vercel function instance has its own Map, so this is per-instance.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}

export function isRateLimited(
  ip: string,
  path: string,
  limit: number,
  windowMs: number
): boolean {
  cleanup();

  const key = `${ip}:${path}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  if (entry.count > limit) {
    return true;
  }

  return false;
}

/**
 * Get rate limit config for a given pathname.
 * Returns { limit, windowMs } or null if no rate limiting applies.
 */
export function getRateLimitConfig(pathname: string): { limit: number; windowMs: number } | null {
  if (pathname.startsWith("/api/webhook")) {
    return { limit: 60, windowMs: 60_000 }; // 60 req/min
  }
  if (pathname.startsWith("/api/cron")) {
    return { limit: 10, windowMs: 60_000 }; // 10 req/min
  }
  if (pathname.startsWith("/api/")) {
    return { limit: 100, windowMs: 60_000 }; // 100 req/min
  }
  return null; // No rate limiting for non-API routes
}
