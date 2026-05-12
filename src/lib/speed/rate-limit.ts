// Pre-launch hardening Step 2 (2026-05-11): in-process sliding-window rate
// limiter for /api/speed/{quote,trade,cashout}.
//
// Per-Lambda-instance only — multiple instances don't share counters, but
// each Lambda enforces its own slice. Combined with the small pool size,
// this caps a single user/IP's blast radius without needing Redis.
//
// Two limit tiers per endpoint:
//   - per-user (when authenticated)  — primary defense
//   - per-IP (fallback for missing/forged user) — anti-flood
//
// Returns the soonest expiring window's retry-after seconds when blocked.
//
// Defaults chosen to be comfortably above legitimate UX traffic:
//   /quote   — 60/10s  (client polls every 1.5s = 7/10s; 60 leaves room
//              for tab-switching, multi-position users, the dock cards)
//   /trade   — 10/10s  (humans don't fire trades faster than this; the
//              RPC's velocity guard handles the per-minute layer)
//   /cashout — 10/10s  (same shape as /trade)
//
// When over: 429 with Retry-After (in seconds). Caller decides body shape.

const WINDOWS: Record<string, { perUser: number; perIp: number; windowMs: number }> = {
  quote:   { perUser: 60, perIp: 120, windowMs: 10_000 },
  // Plan B4: bumped trade/cashout from 10→20 per 10s per user (and 20→40
  // per IP). The RPC's own velocity guard (speed_per_user_velocity_max =
  // 30/min) is the authoritative defense; this HTTP layer is anti-flood
  // only. 10/10s was tripping legitimate frustration-spam from users
  // whose first tap felt unresponsive and produced confusing "Too many
  // requests" toasts.
  trade:   { perUser: 20, perIp:  40, windowMs: 10_000 },
  cashout: { perUser: 20, perIp:  40, windowMs: 10_000 },
};

// key -> array of unix-ms timestamps; pruned on read.
const buckets = new Map<string, number[]>();
const BUCKET_MAX_KEYS = 10_000;

function pruneAndCount(key: string, windowMs: number): number {
  const now = Date.now();
  const arr = buckets.get(key);
  if (!arr) return 0;
  const cutoff = now - windowMs;
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
  if (arr.length === 0) buckets.delete(key);
  return arr.length;
}

function appendHit(key: string): void {
  if (buckets.size >= BUCKET_MAX_KEYS) {
    // crude eviction: drop the oldest key
    const k = buckets.keys().next().value;
    if (k !== undefined) buckets.delete(k);
  }
  const arr = buckets.get(key) ?? [];
  arr.push(Date.now());
  buckets.set(key, arr);
}

/** Result of a rate-limit check. */
export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the offending window starts releasing slots (>= 1). Only set when ok=false. */
  retryAfter: number;
}

/**
 * Check whether a request should be allowed. If allowed, records the hit
 * (so subsequent checks within the window count it). If blocked, does NOT
 * record — callers retrying see a stable Retry-After.
 *
 * @param endpoint One of "quote" | "trade" | "cashout"
 * @param userId   Authenticated user id, or null if anonymous
 * @param ip       Client IP (req.headers x-forwarded-for, etc.)
 */
export function checkRateLimit(
  endpoint: keyof typeof WINDOWS,
  userId: string | null,
  ip: string | null
): RateLimitResult {
  const cfg = WINDOWS[endpoint];
  if (!cfg) return { ok: true, retryAfter: 0 };

  // Per-user check (authoritative when present)
  if (userId) {
    const k = `u:${endpoint}:${userId}`;
    const n = pruneAndCount(k, cfg.windowMs);
    if (n >= cfg.perUser) {
      return { ok: false, retryAfter: Math.ceil(cfg.windowMs / 1000) };
    }
  }
  // Per-IP check (always evaluated; defends against unauthenticated floods)
  if (ip) {
    const k = `i:${endpoint}:${ip}`;
    const n = pruneAndCount(k, cfg.windowMs);
    if (n >= cfg.perIp) {
      return { ok: false, retryAfter: Math.ceil(cfg.windowMs / 1000) };
    }
  }

  // Within both limits — record.
  if (userId) appendHit(`u:${endpoint}:${userId}`);
  if (ip) appendHit(`i:${endpoint}:${ip}`);
  return { ok: true, retryAfter: 0 };
}

/** Extract client IP from a Next request, best-effort. */
export function getClientIp(req: Request): string | null {
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) {
    // first IP in the chain is the client (Vercel sets this).
    const first = xfwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return null;
}
