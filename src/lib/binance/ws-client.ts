"use client";

// Group B: Binance public WebSocket client used by the frontend chart and
// price-related UI for sub-second updates (~10-30/sec for BTC during normal
// hours). Free, no auth, no rate limit within reason.
//
// Singleton — one WS connection per browser tab regardless of how many
// React subscribers there are. Each subscriber registers a callback;
// disconnect is automatic when the last subscriber unsubscribes.
//
// Used purely for visual smoothness. Trade execution and settlement read
// from the server-side oracle (`speed_oracle_latest`), so a frontend WS
// failure or browser-side block degrades gracefully to the existing
// `/api/speed/oracle` polling path (handled in use-speed-oracle wrapper).

export type BinanceStream = "trade" | "bookTicker";

export interface BinanceTickerSnapshot {
  price: number;
  /** Binance event timestamp (ms). */
  ts: number;
  /** Server clock when the message was observed (ms). */
  observedAt: number;
}

export interface BinanceBookTickerSnapshot {
  bid: number;
  ask: number;
  observedAt: number;
}

type Listener<T> = (snapshot: T) => void;

interface ChannelState<T> {
  ws: WebSocket | null;
  listeners: Set<Listener<T>>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastSnapshot: T | null;
}

const STREAM_HOST = "wss://stream.binance.com:9443/ws";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const tradeChannels = new Map<string, ChannelState<BinanceTickerSnapshot>>();
const bookChannels = new Map<string, ChannelState<BinanceBookTickerSnapshot>>();

function backoffMs(attempt: number): number {
  const base = Math.min(
    RECONNECT_MIN_MS * Math.pow(2, Math.min(attempt, 10)),
    RECONNECT_MAX_MS,
  );
  return base + Math.floor(Math.random() * 250);
}

function symbolToTradeStream(symbol: string): string {
  return `${symbol.toLowerCase()}@trade`;
}

function symbolToBookTickerStream(symbol: string): string {
  return `${symbol.toLowerCase()}@bookTicker`;
}

interface BinanceTradeMessage {
  e: "trade";
  E: number;
  s: string;
  t: number;
  p: string;
  q: string;
  T: number;
}

interface BinanceBookTickerMessage {
  u: number;
  s: string;
  b: string;
  B: string;
  a: string;
  A: string;
}

function ensureTradeChannel(symbol: string): ChannelState<BinanceTickerSnapshot> {
  const key = symbol.toUpperCase();
  let state = tradeChannels.get(key);
  if (state) return state;
  state = {
    ws: null,
    listeners: new Set(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    lastSnapshot: null,
  };
  tradeChannels.set(key, state);
  return state;
}

function ensureBookChannel(
  symbol: string,
): ChannelState<BinanceBookTickerSnapshot> {
  const key = symbol.toUpperCase();
  let state = bookChannels.get(key);
  if (state) return state;
  state = {
    ws: null,
    listeners: new Set(),
    reconnectAttempts: 0,
    reconnectTimer: null,
    lastSnapshot: null,
  };
  bookChannels.set(key, state);
  return state;
}

function connectTrade(symbol: string): void {
  const state = ensureTradeChannel(symbol);
  if (state.ws) return;
  if (typeof window === "undefined") return;

  // iOS Safari throws SecurityError on `new WebSocket(...)` when the
  // network or device blocks the WSS connection (Lockdown Mode, corporate
  // proxy, some content blockers). Trade execution + settlement still
  // read the server-side oracle via /api/speed/oracle, so a frontend WS
  // failure is purely a chart-smoothness regression — degrade silently
  // and let the polling fallback in use-speed-oracle take over.
  const url = `${STREAM_HOST}/${symbolToTradeStream(symbol)}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    return;
  }
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.reconnectAttempts = 0;
  });

  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data as string) as BinanceTradeMessage;
      if (data.e !== "trade") return;
      const price = Number(data.p);
      if (!Number.isFinite(price) || price <= 0) return;
      const snapshot: BinanceTickerSnapshot = {
        price,
        ts: data.T,
        observedAt: Date.now(),
      };
      state.lastSnapshot = snapshot;
      state.listeners.forEach((cb) => {
        try {
          cb(snapshot);
        } catch {
          // listener errors must not break the channel
        }
      });
    } catch {
      // parse errors silently dropped — Binance occasionally sends
      // non-JSON keepalives we don't care about
    }
  });

  ws.addEventListener("close", () => {
    state.ws = null;
    if (state.listeners.size === 0) return;
    const delay = backoffMs(state.reconnectAttempts++);
    state.reconnectTimer = setTimeout(() => connectTrade(symbol), delay);
  });

  ws.addEventListener("error", () => {
    // close handler runs after error and triggers reconnect
  });
}

function connectBook(symbol: string): void {
  const state = ensureBookChannel(symbol);
  if (state.ws) return;
  if (typeof window === "undefined") return;

  // Same defensive guard as connectTrade — iOS Safari throws SecurityError
  // on the WebSocket constructor when WSS is blocked by the network/device.
  const url = `${STREAM_HOST}/${symbolToBookTickerStream(symbol)}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    return;
  }
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.reconnectAttempts = 0;
  });

  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data as string) as BinanceBookTickerMessage;
      const bid = Number(data.b);
      const ask = Number(data.a);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
      const snapshot: BinanceBookTickerSnapshot = {
        bid,
        ask,
        observedAt: Date.now(),
      };
      state.lastSnapshot = snapshot;
      state.listeners.forEach((cb) => {
        try {
          cb(snapshot);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  });

  ws.addEventListener("close", () => {
    state.ws = null;
    if (state.listeners.size === 0) return;
    const delay = backoffMs(state.reconnectAttempts++);
    state.reconnectTimer = setTimeout(() => connectBook(symbol), delay);
  });

  ws.addEventListener("error", () => {
    // close handler triggers reconnect
  });
}

function teardownTrade(symbol: string): void {
  const state = tradeChannels.get(symbol.toUpperCase());
  if (!state || state.listeners.size > 0) return;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (state.ws) {
    try {
      state.ws.close(1000, "no listeners");
    } catch {
      // ignore
    }
    state.ws = null;
  }
}

function teardownBook(symbol: string): void {
  const state = bookChannels.get(symbol.toUpperCase());
  if (!state || state.listeners.size > 0) return;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (state.ws) {
    try {
      state.ws.close(1000, "no listeners");
    } catch {
      // ignore
    }
    state.ws = null;
  }
}

/**
 * Subscribe to live trades for a symbol. Returns an unsubscribe function.
 * Connection management is automatic — first subscriber opens the WS,
 * last unsubscriber closes it.
 */
export function subscribeTrade(
  symbol: string,
  listener: Listener<BinanceTickerSnapshot>,
): () => void {
  const state = ensureTradeChannel(symbol);
  state.listeners.add(listener);
  if (state.lastSnapshot) {
    try {
      listener(state.lastSnapshot);
    } catch {
      // ignore
    }
  }
  connectTrade(symbol);
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0) teardownTrade(symbol);
  };
}

export function subscribeBookTicker(
  symbol: string,
  listener: Listener<BinanceBookTickerSnapshot>,
): () => void {
  const state = ensureBookChannel(symbol);
  state.listeners.add(listener);
  if (state.lastSnapshot) {
    try {
      listener(state.lastSnapshot);
    } catch {
      // ignore
    }
  }
  connectBook(symbol);
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0) teardownBook(symbol);
  };
}
