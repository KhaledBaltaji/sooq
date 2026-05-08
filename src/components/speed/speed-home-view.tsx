"use client";

// Editorial Featured-page layout. Replaces the old hero+grid stack with:
//   - eyebrow + "What's your call?" h1
//   - round-picker pills (5m / 1h)
//   - SpeedHeroV2 (big BTC hero with grid-dot chart + countdown + UP/DOWN)
//   - SpeedMiniCard row for the other duration(s)
//   - Live trade tape + How speed works (two-col)

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSpeedMarkets } from "@/hooks/use-speed-markets";
import type { SpeedDuration } from "@/types/database";
import { SpeedHeroCardSkeleton } from "./speed-hero-card";
import { SpeedHeroV2 } from "./speed-hero-v2";
import { SpeedMiniCard } from "./speed-mini-card";
import { SpeedMiniRow } from "./speed-mini-row";
import { SpeedAssetIcon } from "./speed-asset-icon";
import { LiveTradeTape } from "./live-trade-tape";
import { cn } from "@/lib/utils";

export function SpeedHomeView() {
  const { markets, loading } = useSpeedMarkets({ asset: "BTC" });

  // Default hero: live 5m if present, else first. Sprint 0.6 (mig 0040): 1h
  // markets are no longer rolled, but legacy 1h positions still resolve, so
  // we fall through to whatever the markets list shows as a safety net.
  const fiveMin = markets.find((m) => m.duration === "5m");
  const defaultHeroId = fiveMin?.id ?? markets[0]?.id ?? null;

  const [heroId, setHeroId] = useState<string | null>(null);
  const activeHeroId = heroId ?? defaultHeroId;
  const hero = markets.find((m) => m.id === activeHeroId) ?? markets[0] ?? null;
  const others = markets.filter((m) => m.id !== hero?.id);

  return (
    <div className="space-y-8 lg:space-y-10">
      {/* Functional header. Mobile: smaller h1, eyebrow on its own line.
          Desktop: same header laid out with eyebrow inline. */}
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-satoshi text-xl font-black tracking-tight text-text lg:text-2xl">
            Speed markets
          </h1>
          {markets.length > 0 && (
            <div className={EYEBROW}>
              Live · {markets.length} round{markets.length === 1 ? "" : "s"}{" "}
              open
            </div>
          )}
        </div>
        {markets.length > 0 && (
          // Mobile: horizontal scroll with edge bleed (-mx-4 px-4 pulls the
          // strip flush to the screen edge so pills can slide off-screen).
          // Desktop (lg+): wrap normally inside the page padding.
          <div className="mt-4 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
            {markets.map((m) => {
              const on = m.id === hero?.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setHeroId(m.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 font-satoshi text-xs font-bold tracking-wide transition-colors",
                    on
                      ? "bg-text text-bg"
                      : "bg-elevated text-muted-custom hover:text-text lg:bg-transparent",
                  )}
                >
                  <SpeedAssetIcon asset={m.asset} size="sm" />
                  {m.asset} · {m.duration}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Hero */}
      {loading && !hero ? (
        <SpeedHeroCardSkeleton />
      ) : hero ? (
        <SpeedHeroV2 market={hero} />
      ) : (
        <EmptyState />
      )}

      {/* Other rounds — mobile renders compact horizontal rows; desktop
          renders the existing vertical mini-cards. */}
      {others.length > 0 && (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <div className={EYEBROW}>Other rounds open</div>
            <Link
              href="/markets"
              className="hidden lg:inline-flex items-center gap-1.5 font-satoshi text-xs font-bold tracking-wide text-text hover:underline"
            >
              See all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {/* Mobile: stacked rows */}
          <div className="flex flex-col gap-2 lg:hidden">
            {others.map((m) => (
              <SpeedMiniRow key={m.id} market={m} />
            ))}
          </div>
          {/* Desktop: vertical mini-cards in a constrained grid */}
          <div
            className={cn(
              "hidden gap-4 lg:grid",
              others.length === 1
                ? "lg:grid-cols-1 lg:max-w-[420px]"
                : others.length === 2
                  ? "lg:grid-cols-2"
                  : "lg:grid-cols-3",
            )}
          >
            {others.map((m) => (
              <SpeedMiniCard key={m.id} market={m} />
            ))}
          </div>
        </section>
      )}

      {/* Live tape (mobile) / Live tape + How speed works (desktop). The
          three-step explainer takes too much vertical room on a phone for
          a returning user, so it hides below lg. */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
        <LiveTradeTape />
        <div className="hidden lg:block">
          <HowSpeedWorks />
        </div>
      </div>
    </div>
  );
}

// Single source of truth for editorial eyebrow text — used everywhere
// on the home page so the rhythm reads consistent across sections.
const EYEBROW =
  "font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom";

function HowSpeedWorks() {
  const steps: Array<{ n: string; t: string; d: string }> = [
    {
      n: "01",
      t: "Pick a market",
      d: "Bitcoin to start, on 5-minute or 1-hour rounds.",
    },
    {
      n: "02",
      t: "Tap UP or DOWN",
      d: "You're calling where price closes vs the strike.",
    },
    {
      n: "03",
      t: "Round closes",
      d: "Winners get paid the moment the round settles. Cashout any time before the bell.",
    },
  ];
  return (
    <section>
      <div className={cn(EYEBROW, "mb-5")}>How speed works</div>
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-4">
            <span className="mt-[3px] min-w-[22px] font-satoshi text-[13px] font-black tracking-wider text-muted-custom tabular-nums">
              {s.n}
            </span>
            <div>
              <div className="font-satoshi text-sm font-bold text-text">
                {s.t}
              </div>
              <div className="mt-1 font-dm-sans text-[13px] leading-relaxed text-muted-custom">
                {s.d}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border-custom bg-surface p-8 text-center">
      <p className="font-dm-sans text-sm text-muted-custom">
        No speed markets are open right now. New 5-minute and 1-hour BTC rounds
        roll on every clean clock boundary.
      </p>
    </div>
  );
}
