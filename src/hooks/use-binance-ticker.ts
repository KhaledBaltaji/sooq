"use client";

// Group C: React hook subscribing to Binance @bookTicker WS via the
// singleton client. Returns the top-of-book MID = (bid + ask) / 2 as
// `price`, plus the raw bid/ask in case a caller wants the spread.
//
// Why bookTicker instead of @trade: @trade alternates buyer-/seller-
// initiated prints, so consecutive prices zigzag by spread amount. That
// sawtooth showed up on the chart as visible bouncing even on calm
// markets. Mid is monotonically driven by real flow — no alternation.
//
// Note: bookTicker has no Binance event timestamp; `ts` is the server
// receive-time. Difference vs Binance-side time is sub-10ms.

import { useEffect, useState } from "react";
import {
  subscribeBookTicker,
  type BinanceBookTickerSnapshot,
} from "@/lib/binance/ws-client";

interface TickerResult {
  /** Last observed mid price ((bid+ask)/2); null until first tick. */
  price: number | null;
  /** Binance best bid; null until first tick. */
  bid: number | null;
  /** Binance best ask; null until first tick. */
  ask: number | null;
  /** Server receive-time when this client observed the message (ms). */
  ts: number | null;
  /** Same as `ts` — kept for API compatibility with prior @trade hook. */
  observedAt: number | null;
  /** True once the first tick has arrived (WS handshake succeeded). */
  isLive: boolean;
}

/**
 * Subscribe to Binance @bookTicker for the given symbol (e.g. "BTCUSDT").
 * Returns the latest mid price plus the raw bid/ask. State updates are
 * throttled to the React render cycle — even if Binance pushes hundreds
 * of book updates per second, only the latest is reflected per render.
 */
export function useBinanceTicker(symbol: string): TickerResult {
  const [snap, setSnap] = useState<BinanceBookTickerSnapshot | null>(null);

  useEffect(() => {
    const unsub = subscribeBookTicker(symbol, (s) => {
      setSnap(s);
    });
    return unsub;
  }, [symbol]);

  if (!snap) {
    return {
      price: null,
      bid: null,
      ask: null,
      ts: null,
      observedAt: null,
      isLive: false,
    };
  }

  const mid = (snap.bid + snap.ask) / 2;
  return {
    price: Number.isFinite(mid) && mid > 0 ? mid : null,
    bid: snap.bid,
    ask: snap.ask,
    ts: snap.observedAt,
    observedAt: snap.observedAt,
    isLive: true,
  };
}

interface BookTickerResult {
  bid: number | null;
  ask: number | null;
  observedAt: number | null;
  isLive: boolean;
}

/**
 * Subscribe to Binance @bookTicker (best bid + ask). Used by optional
 * bid/ask spread display.
 */
export function useBinanceBookTicker(symbol: string): BookTickerResult {
  const [snap, setSnap] = useState<BinanceBookTickerSnapshot | null>(null);

  useEffect(() => {
    const unsub = subscribeBookTicker(symbol, (s) => {
      setSnap(s);
    });
    return unsub;
  }, [symbol]);

  return {
    bid: snap?.bid ?? null,
    ask: snap?.ask ?? null,
    observedAt: snap?.observedAt ?? null,
    isLive: snap !== null,
  };
}
