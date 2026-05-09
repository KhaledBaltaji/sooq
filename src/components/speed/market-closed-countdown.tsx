"use client";

/**
 * MarketClosedCountdown — Phase 5C (mig 0052)
 *
 * Renders when a user opens an asset whose markets are closed (currently
 * only GOLD during weekend gap + daily 21:00-22:00 UTC break per
 * speed_asset_config.GOLD.trading_hours_json).
 *
 * Big prominent live countdown to next market open. Updates every second.
 * Shows in user's local timezone too.
 *
 *   "Gold markets reopen in 2d 14h 32m 18s"
 *   "Sun 22:00 UTC · Mon 1:00 AM Beirut"
 *
 * Data flow:
 *   1. /api/speed/quote returns { is_open, next_open_at } when called
 *      with an asset/market_id whose trading hours are closed.
 *   2. This component receives next_open_at as a prop.
 *   3. Computes time delta locally and re-renders every 1s.
 */

import { useEffect, useState } from "react";
import type { SpeedAsset } from "@/types/database";

interface MarketClosedCountdownProps {
  asset: SpeedAsset;
  /** ISO 8601 timestamp of next market open (server-computed via _speed_next_open_at). */
  nextOpenAt: string;
  /** Optional override: friendly asset name (default: "Gold markets") */
  assetLabel?: string;
}

interface TimeRemaining {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeRemaining(nextOpenAt: string): TimeRemaining {
  const target = new Date(nextOpenAt).getTime();
  const now = Date.now();
  const totalMs = Math.max(0, target - now);
  const totalSec = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatLocalTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function formatUtc(iso: string): string {
  try {
    const d = new Date(iso);
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
    const h = pad(d.getUTCHours());
    const m = pad(d.getUTCMinutes());
    return `${dow} ${h}:${m} UTC`;
  } catch {
    return iso;
  }
}

export function MarketClosedCountdown({
  asset,
  nextOpenAt,
  assetLabel,
}: MarketClosedCountdownProps) {
  const label = assetLabel ?? (asset === "GOLD" ? "Gold markets" : `${asset} markets`);
  const [remaining, setRemaining] = useState<TimeRemaining>(() =>
    computeRemaining(nextOpenAt),
  );

  useEffect(() => {
    // Tick every second. setInterval drift is acceptable at 1s granularity.
    const id = setInterval(() => {
      setRemaining(computeRemaining(nextOpenAt));
    }, 1000);
    return () => clearInterval(id);
  }, [nextOpenAt]);

  // Once we cross zero, the parent should re-fetch quote to get fresh state.
  const isExpired = remaining.totalMs <= 0;

  return (
    <div className="rounded-3xl bg-elevated p-8 lg:p-12 text-center shadow-sm">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
        <span aria-hidden>⏸</span>
        <span>Market closed</span>
      </div>

      <h2 className="font-satoshi text-2xl lg:text-3xl font-black tracking-tight text-text">
        {label} reopen in
      </h2>

      {isExpired ? (
        <p className="mt-6 text-lg text-muted-custom">
          Reopening now — refresh to start trading.
        </p>
      ) : (
        <div className="mt-6 flex justify-center gap-3 lg:gap-5 font-[family-name:var(--font-manrope)] tabular-nums">
          {remaining.days > 0 && (
            <CountdownBlock value={remaining.days} unit="d" />
          )}
          <CountdownBlock value={remaining.hours} unit="h" pad />
          <CountdownBlock value={remaining.minutes} unit="m" pad />
          <CountdownBlock
            value={remaining.seconds}
            unit="s"
            pad
            pulse
          />
        </div>
      )}

      <div className="mt-8 space-y-1 text-sm text-muted-custom">
        <p className="font-medium">{formatUtc(nextOpenAt)}</p>
        <p className="text-xs">
          Local: {formatLocalTime(nextOpenAt)}
        </p>
      </div>

      {asset === "GOLD" && (
        <p className="mt-6 text-xs text-muted-custom max-w-md mx-auto leading-relaxed">
          Gold markets follow real spot-gold trading hours
          (Sun 22:00 UTC – Fri 21:00 UTC, with a daily break at 21:00 UTC).
          Bitcoin trades 24/7 — try BTC while gold sleeps.
        </p>
      )}
    </div>
  );
}

function CountdownBlock({
  value,
  unit,
  pad: shouldPad = false,
  pulse = false,
}: {
  value: number;
  unit: string;
  pad?: boolean;
  pulse?: boolean;
}) {
  const display = shouldPad ? pad(value) : value.toString();
  return (
    <div className="flex flex-col items-center">
      <span
        className={`text-4xl lg:text-6xl font-black text-text leading-none ${
          pulse ? "animate-pulse" : ""
        }`}
      >
        {display}
      </span>
      <span className="mt-1 text-xs uppercase tracking-wider text-muted-custom">
        {unit}
      </span>
    </div>
  );
}
