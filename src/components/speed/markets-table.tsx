"use client";

// Editorial /markets table view. Mirrors mockup's MarketsTable
// (~/Downloads/Sooq/app/markets-page.jsx 77-180). Each row shows a
// market with live price, countdown, and per-row UP/DOWN buttons that
// route to /speed/[id].

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

export function MarketsTable({ markets }: { markets: SpeedMarket[] }) {
  return (
    <div className="hidden md:block">
      <div className="grid grid-cols-[2fr_0.7fr_1fr_1fr_1.4fr] gap-4 border-b border-border-custom py-3 font-satoshi text-[10px] font-bold uppercase tracking-[0.22em] text-muted-custom">
        <span>Market</span>
        <span className="text-right">Round</span>
        <span className="text-right">Price</span>
        <span className="text-right">Closes</span>
        <span className="text-right">Trade</span>
      </div>
      {markets.map((m, i) => (
        <MarketRow key={m.id} market={m} last={i === markets.length - 1} />
      ))}
    </div>
  );
}

function MarketRow({ market, last }: { market: SpeedMarket; last: boolean }) {
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
    <div
      className={cn(
        "grid grid-cols-[2fr_0.7fr_1fr_1fr_1.4fr] items-center gap-4 py-5",
        !last && "border-b border-border-custom",
      )}
    >
      {/* Market */}
      <div className="flex min-w-0 items-center gap-3.5">
        <SpeedAssetIcon asset={market.asset} size="md" />
        <div className="min-w-0">
          <div className="font-satoshi text-[15px] font-bold leading-tight text-text">
            {ASSET_LABELS[market.asset] ?? market.asset}
          </div>
          <div className="mt-1 font-dm-sans text-xs text-muted-custom">
            up or down · strike{" "}
            {strike > 0 ? `$${fmtUSD(strike)}` : "pending"}
          </div>
        </div>
      </div>

      {/* Round */}
      <div className="text-right font-satoshi text-[13px] font-bold uppercase tracking-wide text-muted-custom">
        {market.duration}
      </div>

      {/* Price */}
      <div className="text-right">
        <div className="font-satoshi text-[17px] font-black leading-none tabular-nums text-text">
          ${livePrice ? fmtUSD(livePrice) : "—"}
        </div>
        {strike > 0 && livePrice !== null && (
          <div
            className={cn(
              "mt-1 font-satoshi text-[11px] font-bold tabular-nums",
              isOver ? "text-success" : "text-destructive",
            )}
          >
            {isOver ? "▲" : "▼"} {deltaPct.toFixed(3)}%
          </div>
        )}
      </div>

      {/* Closes */}
      <div
        className={cn(
          "text-right font-satoshi text-[17px] font-black tabular-nums",
          danger ? "text-destructive" : "text-text",
        )}
      >
        {fmtCountdown(remaining)}
      </div>

      {/* Trade */}
      <div className="grid grid-cols-2 gap-1.5">
        <Link
          href={`/speed/${market.id}`}
          onClick={handleNav}
          className="rounded-md bg-success py-2.5 text-center font-satoshi text-xs font-black uppercase tracking-wide text-white shadow-[0_3px_0_0_rgba(18,110,50,0.95)]"
        >
          Up
        </Link>
        <Link
          href={`/speed/${market.id}`}
          onClick={handleNav}
          className="rounded-md bg-destructive py-2.5 text-center font-satoshi text-xs font-black uppercase tracking-wide text-white shadow-[0_3px_0_0_rgba(150,28,38,0.95)]"
        >
          Down
        </Link>
      </div>
    </div>
  );
}
