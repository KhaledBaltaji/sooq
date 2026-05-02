/**
 * Speed Oracle Worker
 *
 * Streams Binance BTC/USDT 1-second klines (pre-built OHLC candles) via
 * WebSocket and writes them into Supabase. Dual-write during the cutover
 * from `@trade` ticks (eng-review locked):
 *
 *   1. `speed_oracle_klines` — full OHLC per closed kline (chart reads this)
 *   2. `speed_oracle_ticks` — synthesized: price = kline.close, ts = kline.t
 *      (settlement RPC `speed_resolve_market` reads this — unchanged path)
 *   3. `speed_oracle_latest` — upserted with kline.close (live-tail cache)
 *
 * Why klines: byte-for-byte match with Binance's own chart, no synthesis CPU,
 * 86K rows/day instead of ~250K-400K from raw trades. Only closed klines are
 * persisted (k.x === true) — in-progress events are skipped.
 *
 * Runs as a single persistent Node process on Railway. One connection, one
 * writer — multiple instances would duplicate writes.
 *
 * Reconnect strategy: exponential backoff capped at 30s.
 * Health endpoint: HTTP GET /health on $PORT (Railway healthcheck).
 */

import * as Sentry from "@sentry/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import http from "http";

// Force unbuffered stdout (Railway log-collector misses buffered output if
// the process crashes before stdout flushes naturally).
process.stdout.write("");
process.stderr.write("");

// Boot banner: visible immediately, before any env validation, so we can
// distinguish "container never started" from "process exited at validation".
console.log(`[oracle] boot — node ${process.version} pid=${process.pid}`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENTRY_DSN = process.env.SENTRY_DSN;
const PORT = Number(process.env.PORT ?? 3000);
console.log(
  `[oracle] PORT=${PORT}, has_url=${!!SUPABASE_URL}, has_key=${!!SUPABASE_SERVICE_ROLE_KEY}, has_sentry=${!!SENTRY_DSN}`,
);
const ASSET = "BTC";
const SOURCE = "binance";
// Switched from @trade (raw individual trades, ~3-5/sec) to @kline_1s
// (pre-built 1-second OHLC candles, exactly 1/sec on close events).
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_LOG_EVERY_MS = 60_000;
// Health: matches fee_config.speed_oracle_stale_seconds so the worker reports
// unhealthy at the same staleness threshold the trade RPC starts rejecting at.
const HEALTH_FRESHNESS_SEC = 2;
// Burst-fail counter: alert once we've seen this many consecutive write
// failures across kline/tick/latest. One failed kline isn't worth paging,
// but a sustained run means writes are dead.
const SUSTAINED_FAIL_THRESHOLD = 30;
// Tick watchdog: detect zombie WebSockets where ws.readyState reports OPEN
// but no closed-kline messages are arriving. Binance @kline_1s emits one
// closed event per second, so 10s without a tick means the connection is
// dead. Force-close → triggers ws.on('close') → scheduleReconnect().
//
// Caught a real outage on 2026-04-29: TCP socket died silently, neither
// 'close' nor 'error' fired, worker sat zombied for 16 minutes (3 markets
// voided) until manual redeploy. This watchdog closes that gap.
const WATCHDOG_INTERVAL_MS = 5_000;
const WATCHDOG_TICK_TIMEOUT_MS = 10_000;
// Boot grace: don't trip the watchdog before the first tick arrives. If
// 30s pass after `ws.on('open')` with zero ticks, force-reconnect — that's
// also a sign of a broken stream (e.g. Binance accepted the upgrade but
// never sent data).
const WATCHDOG_BOOT_GRACE_MS = 30_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0,
  });
  console.log("[oracle] sentry initialised");
} else {
  console.warn("[oracle] SENTRY_DSN unset — running without alerting");
}

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

/**
 * Binance kline event shape (1-second candles).
 *
 * Fires twice per second per symbol: once with `k.x = false` for in-progress
 * updates (we skip these), once with `k.x = true` when the bucket closes
 * (we persist these).
 *
 * @see https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#klinecandlestick-streams-for-utc
 */
interface BinanceKlineEvent {
  e: "kline";
  E: number;       // event time (ms)
  s: string;       // symbol
  k: {
    t: number;     // kline open time (ms)
    T: number;     // kline close time (ms)
    s: string;     // symbol
    i: string;     // interval (e.g. "1s")
    f: number;     // first trade ID in this kline
    L: number;     // last trade ID in this kline
    o: string;     // open price
    c: string;     // close price
    h: string;     // high price
    l: string;     // low price
    v: string;     // base asset volume
    n: number;     // number of trades
    x: boolean;    // is this kline closed?
    q: string;     // quote asset volume
    V: string;     // taker buy base volume
    Q: string;     // taker buy quote volume
    B: string;     // ignore
  };
}

const state = {
  lastTickAt: 0,
  ticksSinceStart: 0,
  ticksSinceLastLog: 0,
  reconnectAttempts: 0,
  connectedAt: 0,
  lastError: null as string | null,
  ws: null as WebSocket | null,
  consecutiveWriteFailures: 0,
  lastSentryAlertAt: 0,
};

/**
 * Capture a worker-level failure to Sentry, throttled so we don't spam.
 * Logs to stdout regardless. No-op if SENTRY_DSN unset.
 */
function reportFailure(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[oracle][${scope}] ${message}`);
  if (!SENTRY_DSN) return;
  // Throttle to one alert per minute per scope to avoid storms.
  const now = Date.now();
  if (now - state.lastSentryAlertAt < 60_000) return;
  state.lastSentryAlertAt = now;
  Sentry.captureMessage(`speed-oracle: ${scope} — ${message}`, {
    level: "error",
    tags: { service: "speed-oracle", scope },
    extra: {
      consecutive_write_failures: state.consecutiveWriteFailures,
      reconnect_attempts: state.reconnectAttempts,
      ticks_since_start: state.ticksSinceStart,
      last_tick_at: state.lastTickAt
        ? new Date(state.lastTickAt).toISOString()
        : null,
    },
  });
}

function backoffMs(): number {
  const attempt = Math.min(state.reconnectAttempts, 10);
  const ms = Math.min(RECONNECT_MIN_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
  return ms + Math.floor(Math.random() * 500);
}

async function writeKline(kline: BinanceKlineEvent["k"]): Promise<void> {
  // Triple-write per closed kline (eng-review locked dual-write strategy):
  //   1. speed_oracle_klines: full OHLC for chart RPC consumption
  //   2. speed_oracle_ticks:  synthesized (price = kline.close, ts = kline.t)
  //                           — settlement RPC (mig 321) reads this, unchanged
  //   3. speed_oracle_latest: cache used by useSpeedOracleLatest live tail
  //
  // All three use ON CONFLICT DO NOTHING / DO UPDATE so retries are safe.
  const tsIso = new Date(kline.t).toISOString();
  const closePrice = Number(kline.c);
  const openPrice = Number(kline.o);
  const highPrice = Number(kline.h);
  const lowPrice = Number(kline.l);
  const volume = Number(kline.v);

  if (
    !Number.isFinite(closePrice) ||
    closePrice <= 0 ||
    !Number.isFinite(openPrice) ||
    !Number.isFinite(highPrice) ||
    !Number.isFinite(lowPrice)
  ) {
    console.warn("[oracle] skipping kline with invalid OHLC:", kline);
    return;
  }

  const klinePromise = supabase
    .from("speed_oracle_klines")
    .upsert(
      {
        asset: ASSET,
        source: SOURCE,
        ts: tsIso,
        open_price: openPrice,
        high_price: highPrice,
        low_price: lowPrice,
        close_price: closePrice,
        volume,
      },
      { onConflict: "asset,ts,source", ignoreDuplicates: true }
    );

  // Synthesized tick: settlement RPC reads (asset, ts, price) — same as before.
  const tickPromise = supabase
    .from("speed_oracle_ticks")
    .upsert(
      { asset: ASSET, source: SOURCE, price: closePrice, ts: tsIso },
      { onConflict: "asset,ts,source", ignoreDuplicates: true }
    );

  const latestPromise = supabase
    .from("speed_oracle_latest")
    .upsert(
      {
        asset: ASSET,
        source: SOURCE,
        price: closePrice,
        ts: tsIso,
        received_at: new Date().toISOString(),
      },
      { onConflict: "asset" }
    );

  const [klineResult, tickResult, latestResult] = await Promise.all([
    klinePromise,
    tickPromise,
    latestPromise,
  ]);
  const errors: string[] = [];
  if (klineResult.error) errors.push(`kline: ${klineResult.error.message}`);
  if (tickResult.error) errors.push(`tick: ${tickResult.error.message}`);
  if (latestResult.error) errors.push(`latest: ${latestResult.error.message}`);

  if (errors.length === 0) {
    state.consecutiveWriteFailures = 0;
    return;
  }

  state.lastError = errors.join("; ");
  state.consecutiveWriteFailures += 1;
  console.error(
    `[oracle] write failure (${state.consecutiveWriteFailures} in a row): ${state.lastError}`,
  );

  // Alert Sentry only after a sustained failure run — one transient hiccup
  // is normal; SUSTAINED_FAIL_THRESHOLD in a row means writes are dead.
  if (state.consecutiveWriteFailures === SUSTAINED_FAIL_THRESHOLD) {
    reportFailure("supabase-write-sustained", new Error(state.lastError));
  }
}

function connect(): void {
  console.log(`[oracle] connecting to ${STREAM_URL} (attempt ${state.reconnectAttempts + 1})`);
  const ws = new WebSocket(STREAM_URL);
  state.ws = ws;

  ws.on("open", () => {
    state.connectedAt = Date.now();
    state.reconnectAttempts = 0;
    console.log(`[oracle] connected at ${new Date(state.connectedAt).toISOString()}`);
  });

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString()) as BinanceKlineEvent;
      if (event.e !== "kline") return;
      // Skip in-progress kline updates — only persist closed buckets.
      // Binance fires k.x = false repeatedly during the second, then once
      // with k.x = true at the boundary. We want the closed one.
      if (!event.k?.x) return;
      state.lastTickAt = Date.now();
      state.ticksSinceStart++;
      state.ticksSinceLastLog++;
      void writeKline(event.k);
    } catch (err) {
      console.error("parse error:", err);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`[oracle] disconnected code=${code} reason=${reason.toString()}`);
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[oracle] ws error:", err.message);
    state.lastError = `ws: ${err.message}`;
    // Persistent reconnect failures (>5 attempts ≈ ~2 minutes of trying)
    // mean Binance is unreachable. Page so we know about it.
    if (state.reconnectAttempts >= 5) {
      reportFailure("ws-reconnect-stuck", err);
    }
  });
}

function scheduleReconnect(): void {
  const delay = backoffMs();
  state.reconnectAttempts++;
  console.log(`[oracle] reconnecting in ${delay}ms`);
  setTimeout(() => connect(), delay);
}

/**
 * Tick watchdog. Runs every WATCHDOG_INTERVAL_MS; if we've been "connected"
 * (ws.readyState === OPEN) without receiving a closed-kline event for
 * WATCHDOG_TICK_TIMEOUT_MS, the socket is zombied — force-terminate so the
 * close handler runs and reconnect kicks in.
 *
 * Skipped when ws is null/CONNECTING/CLOSING/CLOSED — the existing reconnect
 * path is already handling those states.
 */
setInterval(() => {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const now = Date.now();

  // Pre-first-tick: enforce boot grace from the moment the WS opened.
  if (state.lastTickAt === 0) {
    if (state.connectedAt > 0 && now - state.connectedAt > WATCHDOG_BOOT_GRACE_MS) {
      console.warn(
        `[oracle][watchdog] ${WATCHDOG_BOOT_GRACE_MS}ms since open with zero ticks — forcing reconnect`
      );
      reportFailure("watchdog-boot-no-ticks", new Error("boot grace exceeded"));
      ws.terminate();
    }
    return;
  }

  // Steady state: we've seen ticks before; check tick freshness.
  const sinceLastTick = now - state.lastTickAt;
  if (sinceLastTick > WATCHDOG_TICK_TIMEOUT_MS) {
    console.warn(
      `[oracle][watchdog] no ticks for ${sinceLastTick}ms (ws.readyState=OPEN) — forcing reconnect`
    );
    reportFailure(
      "watchdog-zombie-socket",
      new Error(`no ticks for ${sinceLastTick}ms`)
    );
    ws.terminate();
  }
}, WATCHDOG_INTERVAL_MS);

setInterval(() => {
  if (state.ticksSinceLastLog === 0) return;
  console.log(
    `[oracle] heartbeat: ${state.ticksSinceLastLog} ticks/min, total=${state.ticksSinceStart}, last=${
      state.lastTickAt ? new Date(state.lastTickAt).toISOString() : "n/a"
    }`
  );
  state.ticksSinceLastLog = 0;
}, HEARTBEAT_LOG_EVERY_MS);

http
  .createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const now = Date.now();
    const ageSec = state.lastTickAt ? Math.floor((now - state.lastTickAt) / 1000) : null;
    const healthy =
      state.ws?.readyState === WebSocket.OPEN &&
      ageSec !== null &&
      ageSec < HEALTH_FRESHNESS_SEC;
    const body = JSON.stringify({
      healthy,
      connected: state.ws?.readyState === WebSocket.OPEN,
      last_tick_age_sec: ageSec,
      ticks_since_start: state.ticksSinceStart,
      reconnect_attempts: state.reconnectAttempts,
      last_error: state.lastError,
    });
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(body);
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`[oracle] health endpoint on 0.0.0.0:${PORT}/health`);
  });

process.on("SIGTERM", () => {
  console.log("[oracle] SIGTERM received, closing");
  state.ws?.close(1000, "shutdown");
  setTimeout(() => process.exit(0), 1000);
});

connect();
