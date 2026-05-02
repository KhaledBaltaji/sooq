"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { SpeedAsset, SpeedOracleLatest } from "@/types/database";

/**
 * Live BTC price feed.
 *
 * Fetches the latest oracle row, then subscribes to UPDATEs on
 * `speed_oracle_latest`. Worker pushes one row per second (Binance
 * @kline_1s closes), so anything older than 2s means the worker stopped
 * or the realtime channel dropped — same threshold as the trade RPC's
 * `speed_oracle_stale_seconds` rejection (mig 319), so the UI overlay
 * fires on the same boundary the server starts rejecting trades.
 */
export function useSpeedOracleLatest(asset: SpeedAsset = "BTC") {
  const supabase = useSupabase();
  const [oracle, setOracle] = useState<SpeedOracleLatest | null>(null);
  const [loading, setLoading] = useState(true);
  const [channelHealthy, setChannelHealthy] = useState(true);
  const [now, setNow] = useState<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatest(reason: string) {
      try {
        const { data, error } = await supabase
          .from("speed_oracle_latest" as never)
          .select("*")
          .eq("asset", asset)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.warn(
            `[speed_oracle] fetch failed (${reason}):`,
            error.message,
          );
          return;
        }
        if (data) setOracle(data as SpeedOracleLatest);
      } catch (err) {
        if (cancelled) return;
        console.warn(`[speed_oracle] fetch threw (${reason}):`, err);
      } finally {
        setLoading(false);
      }
    }
    fetchLatest("initial");

    const channel = supabase
      .channel(`speed_oracle_latest-${asset}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "speed_oracle_latest",
          filter: `asset=eq.${asset}`,
        },
        (payload) => setOracle(payload.new as SpeedOracleLatest),
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          setChannelHealthy(true);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // Log the underlying error if Supabase provided one — needed to
          // distinguish RLS rejection / filter syntax / WS auth / etc.
          console.error(
            `speed_oracle_latest realtime ${status} for ${asset}`,
            err ?? "(no error object)",
          );
          setChannelHealthy(false);
          // On WS drop, force an immediate poll so we don't wait for the
          // next 2s tick while reconnect backoff runs.
          fetchLatest(`channel-${status}`);
        }
      });

    // Polling fallback. Always-on at 2s — realtime via postgres_changes
    // has been unreliable (WS closes silently with no error object) and
    // we'd rather pay one extra SELECT per 2s than blank the trade panel.
    // When realtime IS healthy it pre-empts the poll, so this is just a
    // safety net.
    const pollId = setInterval(() => {
      void fetchLatest("poll");
    }, 2000);

    // Visibility / online: when the tab regains focus or the network comes
    // back, the polling timer may have been throttled to 1/min by the
    // browser. Force an immediate refresh so the user doesn't see a fake
    // "RECONNECTING" badge for the first 2s after switching back.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void fetchLatest("visibility");
      }
    };
    const onOnline = () => void fetchLatest("online");
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }

    // 1Hz tick to drive countdown + staleness UI even if oracle pauses
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(pollId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    };
  }, [supabase, asset]);

  const price = oracle ? Number(oracle.price) : null;
  const receivedAt = oracle ? new Date(oracle.received_at).getTime() : null;
  const staleSeconds = receivedAt ? (now - receivedAt) / 1000 : null;
  // Staleness threshold for the UI overlay. Loosened from 2s → 8s on
  // 2026-04-29 because:
  //
  //   - Polling runs every 2s, so even on a perfect connection the gap
  //     between consecutive `received_at` values can naturally be 2-3s,
  //     causing a permanent "RECONNECTING" flicker.
  //   - WS reconnects after a transient drop take 1-3s with exponential
  //     backoff. A 2s threshold paints the badge during every reconnect.
  //   - The server-side trade RPC has its own 2s rejection
  //     (fee_config.speed_oracle_stale_seconds) — that's authoritative;
  //     if a user clicks Trade while data is 5s old, the server still
  //     rejects with a clear error. The UI doesn't need to mirror that
  //     boundary to be safe.
  //
  // 8s catches actual outages (oracle worker stalled, prolonged WS
  // failure) while ignoring normal network jitter.
  const isStale = staleSeconds === null || staleSeconds > 8;

  return { oracle, price, staleSeconds, isStale, loading };
}
