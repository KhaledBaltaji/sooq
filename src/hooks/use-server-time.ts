"use client";

// Clock-skew correction. Polls /api/time every 60s, caches the offset
// between server and device, and exposes `serverNow()` so every
// `secondsLeft` calc in speed components reads from a corrected clock.
//
// Why this matters: every speed countdown is computed as
// `(closesAt - Date.now()) / 1000`. If the user's device clock is off by
// 30s vs the server, they see "0:00 ENDS IN" while the server still
// considers the round in-window — or vice versa, they see plenty of time
// remaining and tap Buy only to get a cryptic late-window reject. T3.2.

import { useEffect, useState, useCallback } from "react";

interface ServerTimeResponse {
  serverTimeMs: number;
}

const POLL_INTERVAL_MS = 60_000;

let cachedOffsetMs = 0;
let lastSampleAt = 0;
let inflight: Promise<void> | null = null;

async function sample(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const sentAt = Date.now();
      const res = await fetch("/api/time", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ServerTimeResponse;
      const recvAt = Date.now();
      // Round-trip approximation: server timestamp is observed somewhere
      // in (sentAt, recvAt). Use midpoint as the device clock reading at
      // server's instant. Offset = server − device.
      const midpoint = (sentAt + recvAt) / 2;
      cachedOffsetMs = data.serverTimeMs - midpoint;
      lastSampleAt = recvAt;
    } catch {
      // Silent — fall back to zero offset (device clock as-is).
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Subscribe to server-time correction. Returns a `serverNow()` function
 * that yields the current server epoch ms (with offset applied).
 *
 * Idempotent across components — only one component needs to mount this
 * hook for the offset to stay fresh app-wide.
 */
export function useServerTime() {
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Sample on mount, on tab focus, on coming back online, and every 60s.
    const tick = async () => {
      await sample();
      if (!cancelled) force((n) => n + 1);
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);

    const onFocus = () => {
      if (Date.now() - lastSampleAt > 5_000) tick();
    };
    const onOnline = () => tick();

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const serverNow = useCallback(() => Date.now() + cachedOffsetMs, []);

  return { serverNow, offsetMs: cachedOffsetMs, lastSampleAt };
}

/**
 * Module-level `serverNow()` for places where a hook isn't ergonomic
 * (utility functions, etc.). The offset is updated by any component
 * that uses `useServerTime`.
 */
export function serverNow(): number {
  return Date.now() + cachedOffsetMs;
}
