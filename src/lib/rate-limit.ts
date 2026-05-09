/**
 * Simple in-memory sliding window rate limiter.
 * No Redis needed — suitable for single-instance Vercel deployments.
 * Each Vercel function instance has its own Map, so this is per-instance.
 *
 * KNOWN LIMITATION (S0.14 from /investigate audit):
 *
 *   On Vercel staging, multiple function instances run in parallel under
 *   load. Each holds its own Map. An attacker hitting instance A 100×
 *   then instance B 100× is under each per-instance limit (100/min)
 *   even though they exceeded the intended 100/min global limit. The
 *   effective rate limit can be (instance_count × per_instance_limit).
 *
 *   This is acceptable for current staging traffic (Vercel auto-scales
 *   to maybe 2-3 instances at peak; effective limit stays sane). It WILL
 *   become a real defense gap as traffic grows or if someone runs a
 *   distributed bot.
 *
 * MIGRATION TO SHARED STORE — when ready (founder action item):
 *
 *   1. Pick a shared backend. Options:
 *      - Upstash Redis ($10/mo basic; @upstash/ratelimit) — recommended
 *      - Vercel KV (Vercel-native, stable, similar pricing)
 *      - Supabase / RDS as a counter table (high-latency for ≥30 ops/sec)
 *
 *   2. Set env vars in Vercel staging + GH secrets:
 *      - UPSTASH_REDIS_REST_URL
 *      - UPSTASH_REDIS_REST_TOKEN
 *
 *   3. Install dep: `npm i @upstash/ratelimit @upstash/redis`
 *
 *   4. Replace this file's body with an Upstash-backed sliding-window
 *      limiter (Upstash docs: https://upstash.com/docs/redis/sdks/ratelimit-ts).
 *      Keep the existing API surface (`isRateLimited`, `getRateLimitConfig`)
 *      so callers don't change.
 *
 *   5. Tighten the OTP send-route limit while you're in there — see
 *      src/app/api/auth/send-otp/route.ts where unknown-IP callers can
 *      currently spray (S0.24 audit finding). The "unknown" IP bucket
 *      should be much tighter (5/5min total) than identified IPs.
 *
 * Until then this file ships unchanged. Document the per-instance limit
 * in CLAUDE.md "Known limitations" if traffic grows.
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
