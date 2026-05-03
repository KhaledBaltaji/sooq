"use client";

// W7 cutover: Drizzle/RDS-backed via /api/balance-history.
//
// LMSR positions + AMM live-price logic from prediction-market is gone in
// the slim Sooq schema (W2/W3 strip). Balance history reduces to plotting
// the post-balance from each transaction, then computing PnL as
// last_balance - first_balance over the selected range.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSession } from "@/lib/auth/hooks";

export type PnlRange = "1D" | "1W" | "1M" | "ALL";

export interface BalancePoint {
  time: number;
  balance: number;
}

interface PointsResponse {
  points: Array<{ ts: string; balance: number }>;
}

const PERIODS: { key: PnlRange; hours: number }[] = [
  { key: "1D", hours: 24 },
  { key: "1W", hours: 168 },
  { key: "1M", hours: 720 },
  { key: "ALL", hours: 0 },
];

function getSinceIso(range: PnlRange): string {
  const hours = PERIODS.find((p) => p.key === range)?.hours ?? 0;
  if (hours === 0) {
    // ALL — go back ~5 years; the API caps it server-side.
    return new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
  }
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function useBalanceHistory(range: PnlRange) {
  const { user } = useSession();

  const sinceIso = getSinceIso(range);

  const query = useQuery<PointsResponse>({
    queryKey: ["balance-history", user?.id, range],
    queryFn: async () => {
      const res = await fetch(
        `/api/balance-history?since=${encodeURIComponent(sinceIso)}`
      );
      if (!res.ok) throw new Error(`Failed to load balance history (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id),
    // Refresh on the same cadence as transactions; charts feel fresh enough.
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const data = useMemo<BalancePoint[]>(() => {
    const raw = query.data?.points ?? [];
    if (raw.length === 0) return [];

    const points: BalancePoint[] = raw.map((p) => ({
      time: new Date(p.ts).getTime(),
      balance: p.balance,
    }));

    // Single-point → emit a flat line over the last second so the chart
    // doesn't look empty.
    if (points.length === 1) {
      return [{ time: points[0].time - 1000, balance: points[0].balance }, points[0]];
    }
    return points;
  }, [query.data]);

  const { pnlAmount, pnlPercent } = useMemo(() => {
    if (data.length < 2) return { pnlAmount: 0, pnlPercent: 0 };
    const first = data[0].balance;
    const last = data[data.length - 1].balance;
    const amount = last - first;
    const percent = first !== 0 ? (amount / Math.abs(first)) * 100 : 0;
    return { pnlAmount: amount, pnlPercent: percent };
  }, [data]);

  return { data, loading: query.isLoading, pnlAmount, pnlPercent };
}
