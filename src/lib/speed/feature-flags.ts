// Pre-launch hardening Step 9 (2026-05-11): in-process feature-flag cache
// to short-circuit /quote, /trade, /cashout when their gate is off — so
// disabled features don't waste DB cycles.
//
// Reads fee_config + speed_market_config every FLAG_CACHE_TTL_MS (30s)
// and serves answers from memory in between. Per-Lambda-instance only;
// no Redis. Worst-case staleness on a flag flip is 30s — acceptable for
// kill switches that are flipped manually + announced.
//
// Why not check inside the RPC? The RPCs DO check, but by then we've
// already authenticated, opened a transaction, set the user_id GUC, and
// run the pricing CTE. The whole point of an off feature is "don't do
// any work." This module makes the off-path constant-time and DB-free.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { SpeedAsset, SpeedDuration } from "@/types/database";

const FLAG_CACHE_TTL_MS = 30_000;

export interface SpeedFlagSnapshot {
  /** speed_markets_enabled — global trading kill switch. */
  trading_enabled: boolean;
  /** speed_cashout_enabled — global cashout kill switch. */
  cashout_enabled: boolean;
  /** speed_1m_markets_enabled — 1m duration gate. */
  enabled_1m: boolean;
  /** speed_gold_markets_enabled — gold asset gate. */
  enabled_gold: boolean;
  /** Per-market enabled flags from speed_market_config. */
  market_enabled: Map<string, boolean>; // key: `${asset}:${duration}`
  loaded_at: number;
}

let cached: SpeedFlagSnapshot | null = null;
let inFlight: Promise<SpeedFlagSnapshot> | null = null;

async function loadFlags(): Promise<SpeedFlagSnapshot> {
  // fee_config global flags
  const ffRes = await db.execute(sql`
    SELECT fee_type, rate FROM fee_config
    WHERE fee_type IN (
      'speed_markets_enabled',
      'speed_cashout_enabled',
      'speed_1m_markets_enabled',
      'speed_gold_markets_enabled'
    )
  `);
  const ff = new Map<string, number>();
  for (const r of ffRes.rows as Array<{ fee_type: string; rate: string | number }>) {
    ff.set(r.fee_type, Number(r.rate));
  }

  // per-market enabled bits
  const mcRes = await db.execute(sql`
    SELECT asset, duration::text AS duration, enabled
    FROM speed_market_config
  `);
  const market_enabled = new Map<string, boolean>();
  for (const r of mcRes.rows as Array<{ asset: string; duration: string; enabled: boolean }>) {
    market_enabled.set(`${r.asset}:${r.duration}`, r.enabled === true);
  }

  return {
    trading_enabled: (ff.get("speed_markets_enabled") ?? 1) > 0,
    cashout_enabled: (ff.get("speed_cashout_enabled") ?? 1) > 0,
    enabled_1m: (ff.get("speed_1m_markets_enabled") ?? 0) > 0,
    enabled_gold: (ff.get("speed_gold_markets_enabled") ?? 0) > 0,
    market_enabled,
    loaded_at: Date.now(),
  };
}

/**
 * Return current feature-flag snapshot. Cached for FLAG_CACHE_TTL_MS;
 * single-flight loader (concurrent callers share one DB roundtrip).
 *
 * On DB error, returns last good snapshot if present; otherwise a
 * fail-OPEN default (assume on) so a flag-cache outage doesn't take
 * the platform down. The RPC-side checks are the authoritative gate;
 * this is a perf optimization, not a security boundary.
 */
export async function getSpeedFlags(): Promise<SpeedFlagSnapshot> {
  const now = Date.now();
  if (cached && now - cached.loaded_at < FLAG_CACHE_TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = loadFlags()
    .then((snap) => {
      cached = snap;
      inFlight = null;
      return snap;
    })
    .catch((err) => {
      inFlight = null;
      logger.error("speed.feature_flags load failed", { source: "speed/feature-flags" }, err);
      if (cached) return cached;
      // Fail-open default; RPC will still enforce.
      return {
        trading_enabled: true,
        cashout_enabled: true,
        enabled_1m: true,
        enabled_gold: false,
        market_enabled: new Map(),
        loaded_at: now,
      } as SpeedFlagSnapshot;
    });
  return inFlight;
}

/** Lookup a specific (asset, duration) market's enabled bit; defaults true if row missing. */
export function isMarketEnabled(snap: SpeedFlagSnapshot, asset: SpeedAsset, duration: SpeedDuration): boolean {
  const v = snap.market_enabled.get(`${asset}:${duration}`);
  return v === undefined ? true : v;
}
