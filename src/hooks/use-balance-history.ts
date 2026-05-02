"use client";

import { useEffect, useState, useMemo } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";

export type PnlRange = "1D" | "1W" | "1M" | "ALL";

export interface BalancePoint {
  time: number;
  balance: number;
}

const PERIODS: { key: PnlRange; hours: number }[] = [
  { key: "1D", hours: 24 },
  { key: "1W", hours: 168 },
  { key: "1M", hours: 720 },
  { key: "ALL", hours: 0 },
];

/** Transaction types that represent external money entering/leaving the system */
const EXTERNAL_TYPES = new Set([
  "deposit",
  "withdrawal",
  "seed",
  "bonus",
  "admin_credit",
  "admin_debit",
  "commission",
  "agent_transfer_in",
  "agent_transfer_out",
]);

function getCutoffMs(range: PnlRange): number | null {
  const hours = PERIODS.find((p) => p.key === range)?.hours ?? 0;
  if (hours === 0) return null;
  return Date.now() - hours * 60 * 60 * 1000;
}

interface TxnRow {
  type: string;
  amount: number;
  balance_after: number;
  created_at: string;
}

interface TradeRow {
  market_id: string;
  side: string;
  direction: string;
  shares: number;
  post_yes_price: number | null;
  post_no_price: number | null;
  created_at: string;
}

export function useBalanceHistory(range: PnlRange) {
  const supabase = useSupabase();
  const { user } = useSession();
  const [rawData, setRawData] = useState<BalancePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function compute() {
      setLoading(true);

      // 1. Fetch transactions + trades in parallel
      const [txnRes, tradeRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("type, amount, balance_after, created_at")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: true })
          .limit(2000),
        supabase
          .from("trades")
          .select(
            "market_id, side, direction, shares, post_yes_price, post_no_price, created_at"
          )
          .eq("user_id", user!.id)
          .order("created_at", { ascending: true })
          .limit(2000),
      ]);

      if (cancelled) return;

      if (txnRes.error || tradeRes.error) {
        console.error("Failed to fetch balance history:", txnRes.error?.message || tradeRes.error?.message);
        setLoading(false);
        return;
      }

      const txns: TxnRow[] = (txnRes.data as TxnRow[]) ?? [];
      const trades: TradeRow[] = (tradeRes.data as TradeRow[]) ?? [];

      if (txns.length === 0) {
        setRawData([]);
        setLoading(false);
        return;
      }

      // 2. Index trades by created_at for fast lookup
      const tradesByTime = new Map<string, TradeRow[]>();
      for (const t of trades) {
        const key = t.created_at;
        const arr = tradesByTime.get(key);
        if (arr) arr.push(t);
        else tradesByTime.set(key, [t]);
      }

      // 3. Walk transactions chronologically and compute P&L at each point
      // positionMap: "marketId:side" → shares held
      const positionMap = new Map<string, number>();
      // priceMap: "marketId" → { yes, no } last known prices
      const priceMap = new Map<string, { yes: number; no: number }>();

      // Infer initial balance (for seeded accounts with no deposit transaction)
      const initialBalance = txns[0].balance_after - txns[0].amount;
      let netDeposits = initialBalance;

      const points: BalancePoint[] = [];

      for (const txn of txns) {
        // Update net deposits for external transaction types
        if (EXTERNAL_TYPES.has(txn.type)) {
          netDeposits += txn.amount;
        }

        // Process any trades at this timestamp
        const matchedTrades = tradesByTime.get(txn.created_at);
        if (matchedTrades) {
          for (const trade of matchedTrades) {
            const posKey = `${trade.market_id}:${trade.side}`;
            const currentShares = positionMap.get(posKey) ?? 0;

            if (trade.direction === "buy") {
              positionMap.set(posKey, currentShares + trade.shares);
            } else {
              positionMap.set(
                posKey,
                Math.max(0, currentShares - trade.shares)
              );
            }

            // Update price map with post-trade prices
            if (
              trade.post_yes_price != null &&
              trade.post_no_price != null
            ) {
              priceMap.set(trade.market_id, {
                yes: trade.post_yes_price,
                no: trade.post_no_price,
              });
            }
          }
          // Remove processed trades to avoid double-matching
          tradesByTime.delete(txn.created_at);
        }

        // Compute total position value at this point
        let positionValue = 0;
        for (const [key, shares] of positionMap) {
          if (shares <= 0) continue;
          const [marketId, side] = key.split(":");
          const prices = priceMap.get(marketId);
          if (!prices) continue;
          const price = side === "yes" ? prices.yes : prices.no;
          positionValue += shares * price;
        }

        const portfolioValue = txn.balance_after + positionValue;
        const pnl = portfolioValue - netDeposits;

        points.push({
          time: new Date(txn.created_at).getTime(),
          balance: pnl,
        });
      }

      // 4. Append a "now" point using live AMM prices
      const openMarketIds = new Set<string>();
      for (const [key, shares] of positionMap) {
        if (shares > 0) openMarketIds.add(key.split(":")[0]);
      }

      if (openMarketIds.size > 0) {
        const { data: ammData } = await supabase
          .from("amm_state")
          .select("market_id, current_yes_price, current_no_price")
          .in("market_id", [...openMarketIds]);

        if (cancelled) return;

        if (ammData) {
          for (const amm of ammData) {
            priceMap.set(amm.market_id, {
              yes: amm.current_yes_price,
              no: amm.current_no_price,
            });
          }
        }

        // Recompute position value with live prices
        let livePositionValue = 0;
        for (const [key, shares] of positionMap) {
          if (shares <= 0) continue;
          const [marketId, side] = key.split(":");
          const prices = priceMap.get(marketId);
          if (!prices) continue;
          livePositionValue +=
            shares * (side === "yes" ? prices.yes : prices.no);
        }

        const lastTxn = txns[txns.length - 1];
        const livePortfolio = lastTxn.balance_after + livePositionValue;
        const livePnl = livePortfolio - netDeposits;

        points.push({
          time: Date.now(),
          balance: livePnl,
        });
      }

      // 5. Apply time range filter
      const cutoff = getCutoffMs(range);
      let filtered = points;
      if (cutoff) {
        // Find the last point before the cutoff as baseline
        let baselineIdx = -1;
        for (let i = points.length - 1; i >= 0; i--) {
          if (points[i].time <= cutoff) {
            baselineIdx = i;
            break;
          }
        }
        if (baselineIdx >= 0) {
          // Include the baseline point (shifted to cutoff time) + all points after
          filtered = [
            { time: cutoff, balance: points[baselineIdx].balance },
            ...points.filter((p) => p.time > cutoff),
          ];
        } else {
          // All points are after cutoff
          filtered = points.filter((p) => p.time >= cutoff);
        }
      }

      // Handle single point → flat line
      if (filtered.length === 1) {
        filtered = [
          { time: filtered[0].time - 1000, balance: filtered[0].balance },
          filtered[0],
        ];
      }

      if (!cancelled) {
        setRawData(filtered);
        setLoading(false);
      }
    }

    compute();

    return () => {
      cancelled = true;
    };
  }, [supabase, user, range]);

  const { pnlAmount, pnlPercent } = useMemo(() => {
    if (rawData.length < 2) return { pnlAmount: 0, pnlPercent: 0 };
    const first = rawData[0].balance;
    const last = rawData[rawData.length - 1].balance;
    const amount = last - first;
    const percent = first !== 0 ? (amount / Math.abs(first)) * 100 : 0;
    return { pnlAmount: amount, pnlPercent: percent };
  }, [rawData]);

  return { data: rawData, loading, pnlAmount, pnlPercent };
}
