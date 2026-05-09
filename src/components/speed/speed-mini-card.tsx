"use client";

// Compact card for the "other rounds" row on home + the grid view on
// /markets. Mirrors mockup's SpeedCard (~/Downloads/Sooq/app/speed.jsx
// 134-194). Live price via oracle, countdown ticking, click → /speed/[id].

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SpeedMarket } from "@/types/database";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { SpeedAssetIcon } from "./speed-asset-icon";

const ASSET_LABELS: Record<string, string> = { BTC: "Bitcoin", GOLD: "Gold" };
const DURATION_LABELS: Record<string, string> = {
  "1m": "1m round",
  "5m": "5m round",
  "1h": "1h round",
};

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

export function SpeedMiniCard({ market }: { market: SpeedMarket }) {
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

  const handleNav = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      e.preventDefault();
      window.location.href = `/speed/${market.id}`;
    }
  };

  return (
    <Link
      href={`/speed/${market.id}`}
      onClick={handleNav}
      className="block rounded-2xl bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-elevated"
    >
      <div className="mb-4 flex items-center gap-3">
        <SpeedAssetIcon asset={market.asset} size="md" />
        <div className="min-w-0 flex-1">
          <div className="font-satoshi text-sm font-bold text-text">
            {ASSET_LABELS[market.asset] ?? market.asset}
          </div>
          <div className="mt-0.5 font-satoshi text-[10px] font-bold uppercase tracking-[0.16em] text-muted-custom">
            {DURATION_LABELS[market.duration] ?? market.duration}
          </div>
        </div>
        <div
          className={cn(
            "font-satoshi text-[13px] font-black tabular-nums",
            danger ? "text-destructive" : "text-muted-custom",
          )}
        >
          {fmtCountdown(remaining)}
        </div>
      </div>

      <div className="mb-1 flex items-baseline gap-2.5">
        <span className="font-satoshi text-[28px] font-black leading-none tracking-tight tabular-nums text-text">
          ${livePrice ? fmtUSD(livePrice) : "—"}
        </span>
        {strike > 0 && livePrice !== null && (
          <span
            className={cn(
              "font-satoshi text-xs font-bold tabular-nums",
              isOver ? "text-success" : "text-destructive",
            )}
          >
            {isOver ? "▲" : "▼"} {deltaPct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="mb-4 font-dm-sans text-[11px] text-muted-custom">
        {strike > 0 ? `Strike $${fmtUSD(strike)}` : "Strike pending"}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg bg-success py-3 text-center font-satoshi text-[13px] font-black uppercase tracking-wide text-white shadow-[0_4px_0_0_rgba(18,110,50,0.95)]">
          Up
        </div>
        <div className="rounded-lg bg-destructive py-3 text-center font-satoshi text-[13px] font-black uppercase tracking-wide text-white shadow-[0_4px_0_0_rgba(150,28,38,0.95)]">
          Down
        </div>
      </div>
    </Link>
  );
}
