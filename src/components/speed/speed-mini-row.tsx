"use client";

// Compact horizontal row for the "Other rounds" list on the mobile home
// page. Mirrors mockup MobileRoundRow (~/Downloads/Sooq (1).zip →
// app/mobile-featured.jsx 290-341). Asset glyph left, name+price middle,
// countdown right. Click → /speed/[id].

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SpeedMarket } from "@/types/database";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { SpeedAssetIcon } from "./speed-asset-icon";

const ASSET_LABELS: Record<string, string> = { BTC: "Bitcoin" };

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mr = m % 60;
    return `${h}h ${String(mr).padStart(2, "0")}m`;
  }
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function fmtUSD(v: number, decimals = 2) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function SpeedMiniRow({ market }: { market: SpeedMarket }) {
  const { price: livePrice } = useSpeedOracleLatest(market.asset);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, new Date(market.closes_at).getTime() - now);
  const danger = remaining < 30_000;
  const strike = market.strike_price ?? livePrice ?? 0;
  const isOver = (livePrice ?? 0) >= strike;
  const deltaPct =
    livePrice && strike
      ? Math.abs(((livePrice - strike) / strike) * 100)
      : 0;

  return (
    <Link
      href={`/speed/${market.id}`}
      className="flex items-center gap-3 rounded-xl bg-surface px-3.5 py-3 transition-colors active:bg-elevated"
    >
      <SpeedAssetIcon asset={market.asset} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-satoshi text-sm font-bold text-text">
            {ASSET_LABELS[market.asset] ?? market.asset}
          </span>
          <span className="font-satoshi text-[10px] font-bold uppercase tracking-[0.16em] text-muted-custom">
            {market.duration}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-satoshi text-sm font-black tabular-nums text-text">
            ${livePrice ? fmtUSD(livePrice) : "—"}
          </span>
          {strike > 0 && livePrice !== null && (
            <span
              className={cn(
                "font-satoshi text-[11px] font-bold tabular-nums",
                isOver ? "text-success" : "text-destructive",
              )}
            >
              {isOver ? "▲" : "▼"} {deltaPct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 font-satoshi text-[13px] font-black tabular-nums",
          danger ? "text-destructive" : "text-text",
        )}
      >
        {fmtCountdown(remaining)}
      </div>
    </Link>
  );
}
