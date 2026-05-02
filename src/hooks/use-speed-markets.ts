"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { isMarketAligned } from "@/lib/speed/pricing";
import type {
  SpeedAsset,
  SpeedDuration,
  SpeedMarket,
} from "@/types/database";

/**
 * Lists all currently-open speed markets, optionally filtered by asset and
 * duration. Useful for the home grid + the speed-markets browse page.
 *
 * Subscribes to INSERTs (new market created by speed-roll cron) and UPDATEs
 * (status changes when markets close/resolve).
 */
export function useSpeedMarkets(opts?: {
  asset?: SpeedAsset;
  durations?: SpeedDuration[];
}) {
  const supabase = useSupabase();
  const [markets, setMarkets] = useState<SpeedMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(Date.now());

  const assetKey = opts?.asset ?? "ALL";
  const durKey = (opts?.durations ?? []).slice().sort().join(",");

  // 1Hz tick so closed-but-not-yet-resolved markets drop from the list
  // immediately when their timer hits 0, instead of waiting up to 60s for
  // pg_cron to flip status away from 'open' via realtime UPDATE.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      let query = supabase
        .from("speed_markets" as never)
        .select("*")
        // Include `pending` so we can fall back to the next-upcoming market
        // when no currently-live one exists (cron gap, cold load mid-rollover).
        .in("status", ["open", "pending"])
        .order("closes_at", { ascending: true });
      if (opts?.asset) query = query.eq("asset", opts.asset);
      if (opts?.durations && opts.durations.length > 0) {
        query = query.in("duration", opts.durations);
      }
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        // Log but don't throw — let the next poll retry. Without this,
        // a transient fetch error leaves the carousel/feed empty forever.
        // eslint-disable-next-line no-console
        console.warn("useSpeedMarkets fetch error", error);
      }
      setMarkets((data as SpeedMarket[]) ?? []);
      setLoading(false);
    }
    fetch();
    // Poll every 10s as a safety net in case the realtime subscription drops
    // (we've seen "Home markets realtime subscription error" in dev). Without
    // this, an empty initial fetch leaves the carousel/feed permanently
    // empty until the user reloads.
    const pollId = window.setInterval(fetch, 10_000);

    const channel = supabase
      .channel(`speed_markets-list-${assetKey}-${durKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "speed_markets" },
        (payload) => {
          const next = payload.new as SpeedMarket;
          const old = payload.old as Partial<SpeedMarket>;
          // Apply asset/duration filter client-side (realtime channel can't
          // accept compound filters easily).
          if (opts?.asset && next?.asset !== opts.asset) return;
          if (
            opts?.durations &&
            opts.durations.length > 0 &&
            next?.duration &&
            !opts.durations.includes(next.duration)
          )
            return;

          setMarkets((prev) => {
            if (payload.eventType === "INSERT") {
              // Allow both `open` and `pending` rows in (Phase 9d fallback).
              if (next.status !== "open" && next.status !== "pending") return prev;
              return [...prev, next].sort((a, b) =>
                a.closes_at.localeCompare(b.closes_at),
              );
            }
            if (payload.eventType === "UPDATE") {
              // Drop the row only when it leaves both `open` and `pending`
              // (e.g. resolved, voided). Pending → open transitions stay in.
              if (next.status !== "open" && next.status !== "pending") {
                return prev.filter((m) => m.id !== next.id);
              }
              return prev.map((m) => (m.id === next.id ? next : m));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((m) => m.id !== old?.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [supabase, assetKey, durKey, opts?.asset, opts?.durations]);

  // Phase 9d: prefer currently-active aligned markets. If there are none
  // (cron gap between rollovers, or cold load before the first one opens),
  // fall back to the soonest-upcoming aligned pending market so the
  // carousel and Speed feed never render empty.
  //
  // Off-clock markets (test artifacts that bypass cron) are dropped — the
  // cron always uses _next_clean_boundary; tests inserting with NOW() leave
  // sub-second precision and arbitrary minutes.
  const aligned = markets.filter((m) => isMarketAligned(m.opens_at, m.duration));
  const live = aligned.filter((m) => {
    const opensAt = new Date(m.opens_at).getTime();
    const closesAt = new Date(m.closes_at).getTime();
    return opensAt <= now && closesAt > now;
  });
  let derived: SpeedMarket[];
  if (live.length > 0) {
    derived = live;
  } else {
    // Soonest-upcoming aligned market (status pending, opens_at > now).
    const upcoming = aligned
      .filter((m) => new Date(m.opens_at).getTime() > now)
      .sort((a, b) => a.opens_at.localeCompare(b.opens_at));
    derived = upcoming.length > 0 ? [upcoming[0]] : [];
  }

  return { markets: derived, loading };
}
