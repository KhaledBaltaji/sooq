"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useDemoMode } from "./use-demo-mode";
import { applyMarkup } from "@/lib/branch-pricing";
import type { AmmState } from "@/types/market";

export type TimePeriod = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export interface PricePoint {
  time: number;
  yes: number;
  no: number;
}

export const ALL_PERIODS: TimePeriod[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

/** Minimum market age (ms) for each period to be available */
const PERIOD_MIN_AGE: Record<TimePeriod, number> = {
  "1H": 0,
  "6H": 2 * 60 * 60 * 1000,
  "1D": 6 * 60 * 60 * 1000,
  "1W": 2 * 24 * 60 * 60 * 1000,
  "1M": 8 * 24 * 60 * 60 * 1000,
  "ALL": 2 * 24 * 60 * 60 * 1000,
};

export function getAvailablePeriods(createdAt?: string): TimePeriod[] {
  if (!createdAt) return ALL_PERIODS;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ALL_PERIODS.filter((p) => ageMs >= PERIOD_MIN_AGE[p]);
}

export function getDefaultPeriod(createdAt?: string): TimePeriod {
  const available = getAvailablePeriods(createdAt);
  if (available.includes("1D")) return "1D";
  return available[available.length - 1];
}

/**
 * Fetch + subscribe to price history for a market.
 *
 * `rawData` is always canonical AMM prices (what the global market feed records).
 * When `yesMarkupPct` and/or `noMarkupPct` are provided (non-zero), the returned
 * `data` has `applyMarkup()` applied to each point so the chart reflects the
 * branch-adjusted price the user is actually quoted. Canonical `rawData` is
 * preserved for callers that need the unadjusted feed.
 */
export function usePriceHistory(
  marketId: string,
  period: TimePeriod,
  createdAt?: string,
  ammState?: AmmState | null,
  yesMarkupPct: number = 0,
  noMarkupPct: number = 0,
) {
  const supabase = useSupabase();
  const isDemo = useDemoMode();
  const tradesTable = isDemo ? "demo_trades" : "trades";
  const rpcName = isDemo ? "demo_get_price_history" : "get_price_history";
  const [rawData, setRawData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const ammRef = useRef(ammState);

  useEffect(() => {
    ammRef.current = ammState;
  }, [ammState]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const rpcArgs = isDemo
        ? { p_market_id: marketId, p_period: period }
        : { p_market_id: marketId, p_period: period, p_created_at: createdAt || null };
      const { data } = await supabase.rpc(rpcName as never, rpcArgs as never);

      if (cancelled) return;

      const rows = data as Array<{ bucket_time: string; yes_price: number; no_price: number }> | null;
      if (rows?.length) {
        setRawData(
          rows.map((r) => ({
            time: new Date(r.bucket_time).getTime(),
            yes: Number(r.yes_price),
            no: Number(r.no_price),
          }))
        );
      } else {
        const y = ammRef.current?.current_yes_price ?? 0.5;
        const n = ammRef.current?.current_no_price ?? 0.5;
        setRawData([
          { time: Date.now() - 86400000, yes: y, no: n },
          { time: Date.now(), yes: y, no: n },
        ]);
      }
      setLoading(false);
    }

    fetchData();

    const ch = supabase
      .channel(`chart-${tradesTable}-${marketId}-${period}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: tradesTable, filter: `market_id=eq.${marketId}` },
        (pl) => {
          const t = pl.new as any;
          let yp: number, np: number;
          if (t.post_yes_price != null && t.post_no_price != null) {
            yp = Number(t.post_yes_price);
            np = Number(t.post_no_price);
          } else {
            const raw = Number(t.price_per_share);
            yp = t.side === "yes" ? raw : 1 - raw;
            np = 1 - yp;
          }
          const ts = new Date(t.created_at).getTime();
          setRawData((prev) => {
            const next = [...prev, { time: ts, yes: yp, no: np }];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [supabase, marketId, period, createdAt, rpcName, tradesTable, isDemo]);

  const data = useMemo(() => {
    let pts = rawData;
    if (pts.length > 0 && ammState) {
      const y = ammState.current_yes_price ?? 0.5;
      const n = ammState.current_no_price ?? 0.5;
      pts = [...pts, { time: Date.now(), yes: y, no: n }];
    }
    // Apply branch markup if configured. applyMarkup returns canonical/(1-pct),
    // which pushes prices upward. Clamp to [0, 0.9999] to keep chart domains sane
    // (a branch quote of 100% shares would be economically impossible anyway).
    if (pts.length > 0 && (yesMarkupPct > 0 || noMarkupPct > 0)) {
      pts = pts.map((p) => ({
        time: p.time,
        yes: yesMarkupPct > 0 ? Math.min(0.9999, applyMarkup(p.yes, yesMarkupPct)) : p.yes,
        no: noMarkupPct > 0 ? Math.min(0.9999, applyMarkup(p.no, noMarkupPct)) : p.no,
      }));
    }
    return pts;
  }, [rawData, ammState, yesMarkupPct, noMarkupPct]);

  return { data, rawData, setRawData, loading };
}
