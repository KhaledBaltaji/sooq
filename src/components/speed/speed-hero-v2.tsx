"use client";

// Editorial Featured-page hero — 2-column layout matching the mockup
// (~/Downloads/Sooq/app/speed.jsx 6-132). LEFT: pills, asset+title, big
// price, vs-strike eyebrow, chart fills remaining height. RIGHT: ROUND
// CLOSES IN eyebrow, oversized countdown, progress bar, then UP/DOWN
// chunky 3D buttons at the bottom. Grid stretches both columns so the
// chart and the right-column content land at the same height.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SpeedMarket } from "@/types/database";
import { useSpeedOracleLatest } from "@/hooks/use-speed-oracle";
import { OdometerNumber } from "./odometer-number";
import { SpeedAssetIcon } from "./speed-asset-icon";
import { SpeedPriceChart } from "./speed-price-chart";

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

export function SpeedHeroV2({ market }: { market: SpeedMarket }) {
  const router = useRouter();
  const { price: livePrice, isStale } = useSpeedOracleLatest(market.asset);
  const [lastShown, setLastShown] = useState<number | null>(null);
  useEffect(() => {
    if (livePrice !== null) setLastShown(livePrice);
  }, [livePrice]);
  const displayPrice = livePrice ?? lastShown;

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const closesAt = new Date(market.closes_at).getTime();
  const opensAt = new Date(market.opens_at).getTime();
  const remaining = Math.max(0, closesAt - now);
  const total = Math.max(1, closesAt - opensAt);
  const progress = Math.min(1, Math.max(0, 1 - remaining / total));
  const danger = remaining < 30_000;

  const strike = market.strike_price ?? displayPrice ?? 0;
  const isOver = (displayPrice ?? 0) >= strike;
  const deltaPct =
    displayPrice && strike
      ? Math.abs(((displayPrice - strike) / strike) * 100)
      : 0;

  const handleNav = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      e.preventDefault();
      window.location.href = `/speed/${market.id}`;
    }
  };

  // Mobile-only: tapping anywhere on the card opens /speed/[id]. The
  // chart canvas's own touch events bubble up here too — that's fine,
  // the trade screen has the same (bigger) chart, so a tap-to-open is
  // the expected mobile gesture.
  const handleCardTap = () => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    router.push(`/speed/${market.id}`);
  };

  return (
    <section
      onClick={handleCardTap}
      className="cursor-pointer overflow-hidden rounded-2xl bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6 lg:cursor-default lg:p-10"
    >
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        {/* LEFT — pills, asset+title, price, vs-strike, chart */}
        <div className="flex min-w-0 flex-col">
          {/* Pills */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5 lg:mb-5 lg:gap-2">
            <span className="rounded-full bg-warning/12 px-2 py-0.5 font-satoshi text-[9px] font-black uppercase tracking-[0.18em] text-warning lg:px-2.5 lg:py-1 lg:text-[10px]">
              Speed
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2 py-0.5 font-satoshi text-[9px] font-black uppercase tracking-[0.18em] text-success lg:px-2.5 lg:py-1 lg:text-[10px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
            <span className="rounded-full bg-elevated px-2 py-0.5 font-satoshi text-[9px] font-bold uppercase tracking-[0.16em] text-muted-custom lg:px-2.5 lg:py-1 lg:text-[10px]">
              {DURATION_LABELS[market.duration] ?? market.duration}
            </span>
          </div>

          {/* Asset + title */}
          <div className="mb-4 flex items-center gap-3 lg:mb-5">
            <SpeedAssetIcon asset={market.asset} size="md" className="lg:hidden" />
            <SpeedAssetIcon asset={market.asset} size="lg" className="hidden lg:inline-flex" />
            <h2 className="font-satoshi text-lg font-black leading-tight tracking-tight text-text sm:text-xl lg:text-[26px]">
              {ASSET_LABELS[market.asset] ?? market.asset}{" "}
              <span className="font-medium text-muted-custom">up or down</span>
            </h2>
          </div>

          {/* Big live price */}
          {displayPrice !== null && (
            <>
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <OdometerNumber
                  value={displayPrice}
                  prefix="$"
                  className={cn(
                    "font-satoshi font-black leading-none tracking-tight tabular-nums",
                    "text-[2.25rem] sm:text-5xl lg:text-6xl",
                    isStale ? "text-muted-custom" : "text-text",
                  )}
                />
                {strike > 0 && (
                  <span
                    className={cn(
                      "font-satoshi text-sm font-bold tabular-nums sm:text-base lg:text-lg",
                      isOver ? "text-success" : "text-destructive",
                    )}
                  >
                    {isOver ? "▲" : "▼"} {deltaPct.toFixed(3)}%
                  </span>
                )}
              </div>
              <div className="mb-4 font-satoshi text-[10px] font-bold uppercase tracking-[0.16em] text-muted-custom lg:mb-6">
                {strike > 0 ? `vs strike $${fmtUSD(strike)}` : "Strike pending"}
              </div>
            </>
          )}

          {/* Chart — shorter on mobile so the hero fits a single phone screen. */}
          {strike > 0 && (
            <div className="grid-dots h-[160px] overflow-hidden rounded-xl sm:h-[200px] lg:h-auto lg:min-h-[240px] lg:flex-1">
              <SpeedPriceChart
                asset={market.asset}
                strikePrice={strike}
                opensAt={market.opens_at}
                closesAt={market.closes_at}
                duration={market.duration}
                chartType="line"
                status={market.status}
                height={260}
                className="rounded-xl"
                hideStrikeLine
              />
            </div>
          )}

          {/* MOBILE-ONLY countdown bar — lives inside the left column on
              mobile (below the chart) so the right-column block stays
              desktop-only. */}
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-bg px-3.5 py-3 lg:hidden">
            <div>
              <div className="font-satoshi text-[9px] font-bold uppercase tracking-[0.2em] text-muted-custom">
                Closes in
              </div>
              <div
                className={cn(
                  "mt-0.5 font-satoshi text-[26px] font-black leading-none tabular-nums tracking-tight",
                  danger ? "text-destructive" : "text-text",
                )}
              >
                {fmtCountdown(remaining)}
              </div>
            </div>
            <div className="flex-1">
              <div className="h-[3px] overflow-hidden rounded-full bg-elevated">
                <div
                  className={cn(
                    "h-full transition-[width] duration-1000 ease-linear",
                    danger ? "bg-destructive" : "bg-text",
                  )}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-2 text-right font-dm-sans text-[10px] text-muted-custom">
                Live{" "}
                <span className="font-satoshi font-bold text-text">
                  {market.asset}/USD
                </span>
              </div>
            </div>
          </div>

          {/* MOBILE-ONLY UP/DOWN — full-width below the countdown bar. */}
          <div className="mt-3 grid grid-cols-2 gap-2.5 lg:hidden">
            <Link
              href={`/speed/${market.id}`}
              onClick={handleNav}
              className="flex items-center justify-center rounded-xl bg-success px-2 py-4 font-satoshi text-base font-black uppercase tracking-wide text-white shadow-[0_4px_0_0_rgba(18,110,50,0.95)] active:translate-y-[3px] active:shadow-[0_1px_0_0_rgba(18,110,50,0.95)]"
            >
              Up
            </Link>
            <Link
              href={`/speed/${market.id}`}
              onClick={handleNav}
              className="flex items-center justify-center rounded-xl bg-destructive px-2 py-4 font-satoshi text-base font-black uppercase tracking-wide text-white shadow-[0_4px_0_0_rgba(150,28,38,0.95)] active:translate-y-[3px] active:shadow-[0_1px_0_0_rgba(150,28,38,0.95)]"
            >
              Down
            </Link>
          </div>
        </div>

        {/* RIGHT — desktop only. Countdown + UP/DOWN with justify-between. */}
        <div className="hidden min-w-0 flex-col justify-between gap-8 lg:flex">
          <div>
            <div className="mb-2 font-satoshi text-[10px] font-bold uppercase tracking-[0.18em] text-muted-custom">
              Round closes in
            </div>
            <div
              className={cn(
                "font-satoshi font-black leading-none tracking-tight tabular-nums",
                "text-7xl",
                danger ? "text-destructive" : "text-text",
              )}
            >
              {fmtCountdown(remaining)}
            </div>
            <div className="mt-4 h-[2px] overflow-hidden rounded-full bg-elevated">
              <div
                className={cn(
                  "h-full transition-[width] duration-1000 ease-linear",
                  danger ? "bg-destructive" : "bg-text",
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="mt-6 font-dm-sans text-xs leading-relaxed text-muted-custom">
              Live BTC oracle ·{" "}
              <span className="font-satoshi font-bold text-text">
                {market.asset}/USD
              </span>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href={`/speed/${market.id}`}
                onClick={handleNav}
                className="flex items-center justify-center rounded-xl bg-success px-2 py-5 font-satoshi text-xl font-black uppercase tracking-wide text-white shadow-[0_5px_0_0_rgba(18,110,50,0.95)] transition-transform duration-[90ms] hover:translate-y-[1px] hover:brightness-105 active:translate-y-[4px] active:shadow-[0_1px_0_0_rgba(18,110,50,0.95)]"
              >
                Up
              </Link>
              <Link
                href={`/speed/${market.id}`}
                onClick={handleNav}
                className="flex items-center justify-center rounded-xl bg-destructive px-2 py-5 font-satoshi text-xl font-black uppercase tracking-wide text-white shadow-[0_5px_0_0_rgba(150,28,38,0.95)] transition-transform duration-[90ms] hover:translate-y-[1px] hover:brightness-105 active:translate-y-[4px] active:shadow-[0_1px_0_0_rgba(150,28,38,0.95)]"
              >
                Down
              </Link>
            </div>
            <div className="mt-3 text-center font-dm-sans text-xs text-muted-custom">
              Pays out the moment the round closes.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
