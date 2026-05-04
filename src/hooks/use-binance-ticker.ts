"use client";

// Group B: React hook subscribing to Binance @trade WS via the singleton
// client. Returns the latest tick and a connection-failed flag so callers
// can fall back to polling our own oracle endpoint when Binance is
// unreachable (e.g., Lebanese ISP block on stream.binance.com).

import { useEffect, useState } from "react";
import {
  subscribeBookTicker,
  subscribeTrade,
  type BinanceBookTickerSnapshot,
  type BinanceTickerSnapshot,
} from "@/lib/binance/ws-client";

interface TickerResult {
  /** Last observed price; null until first tick or while WS unavailable. */
  price: number | null;
  /** Binance event timestamp (ms). */
  ts: number | null;
  /** Server clock when this client observed the message (ms). */
  observedAt: number | null;
  /** True once the first tick has arrived (WS handshake succeeded). */
  isLive: boolean;
}

/**
 * Subscribe to a Binance trade stream for the given symbol (e.g. "BTCUSDT").
 * State updates are throttled to the React render cycle — even if Binance
 * pushes 30 trades/sec, the latest is reflected once per render.
 */
export function useBinanceTicker(symbol: string): TickerResult {
  const [snap, setSnap] = useState<BinanceTickerSnapshot | null>(null);

  useEffect(() => {
    const unsub = subscribeTrade(symbol, (s) => {
      setSnap(s);
    });
    return unsub;
  }, [symbol]);

  return {
    price: snap?.price ?? null,
    ts: snap?.ts ?? null,
    observedAt: snap?.observedAt ?? null,
    isLive: snap !== null,
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
