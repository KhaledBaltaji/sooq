/**
 * Speed Oracle Worker — Sooq v1 (Group B: CFD-feel migration)
 *
 * Streams Binance BTC/USDT trade events via WebSocket and writes them
 * directly to RDS PostgreSQL via the `pg` driver. Single persistent
 * Node process — running >1 replica races the speed_oracle_latest upsert.
 *
 * Stream change (Group B): switched from `btcusdt@kline_1s` to
 * `btcusdt@trade`. The kline stream pushes one event per second; the
 * trade stream pushes one event per actual Binance trade (~10-30/sec
 * for BTC during normal hours, up to 100/sec during volatility).
 *
 * Throttling: writes are flushed at most every FLUSH_INTERVAL_MS to RDS
 * (default 100ms = 10 Hz). The buffered `state.latestTrade` is always
 * the most recent Binance trade observed; the flush interval picks it
 * up and writes one row per flush. This caps RDS write load while still
 * giving sub-second tick granularity for the wick detector and keeping
 * `speed_oracle_latest` fresh enough that trade execution price matches
 * what users see on the chart within ~200ms. Frontend connects to
 * Binance WS directly for visual smoothness; the backend oracle is the
 * source of truth for execution + settlement.
 *
 * Schema:
 *   * `speed_oracle_ticks`: append-only history (ON CONFLICT noop on
 *     (asset, ts, source) — unique index from mig 0008). At 10 Hz,
 *     ~864k rows/day. Partition rotation tracked separately if needed.
 *   * `speed_oracle_latest`: single-row cache, upsert by asset PK.
 *   * `speed_oracle_klines` doesn't exist; chart RPC `get_speed_klines`
 *     synthesizes OHLC from the tick stream at read time (mig 0007).
 *
 * Reconnect: exponential backoff capped at 30s.
 * Watchdog: zombie-WS detector force-closes if no ticks for 10s.
 * Health: GET /health reports stale-detection at 2s threshold (matches
 * fee_config.speed_oracle_stale_seconds → speed_execute_trade rejection).
 */

import * as Sentry from "@sentry/node";
import { Pool } from "pg";
import WebSocket from "ws";
import http from "http";

process.stdout.write("");
process.stderr.write("");
console.log(`[oracle] boot — node ${process.version} pid=${process.pid}`);

const RAW_DATABASE_URL = process.env.DATABASE_URL;
const SENTRY_DSN = process.env.SENTRY_DSN;
const PORT = Number(process.env.PORT ?? 3000);

if (!RAW_DATABASE_URL) {
  console.error("FATAL: DATABASE_URL required");
  process.exit(1);
}

// Strip sslmode from the URL (same trick as src/lib/db/index.ts in the
// Next app). pg-connection-string aliases sslmode=require → verify-full
// in current versions, which forces cert-chain verification and fails
// on the AWS RDS chain. We re-enable SSL with rejectUnauthorized:false
// below — TLS encryption stays on, only chain verification skipped.
const DATABASE_URL = RAW_DATABASE_URL.replace(
  /([?&])sslmode=[^&]+(&|$)/i,
  (_match, prefix, suffix) => (suffix === "&" ? prefix : "")
);
const isRds = DATABASE_URL.includes("rds.amazonaws.com");

console.log(
  `[oracle] PORT=${PORT}, has_db_url=${!!RAW_DATABASE_URL}, has_sentry=${!!SENTRY_DSN}, ssl=${isRds ? "on (no cert verify)" : "off"}`
);

const ASSET = "BTC";
const SOURCE = "binance";
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@trade";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_LOG_EVERY_MS = 60_000;
const HEALTH_FRESHNESS_SEC = 2;
const SUSTAINED_FAIL_THRESHOLD = 30;
const WATCHDOG_INTERVAL_MS = 5_000;
const WATCHDOG_TICK_TIMEOUT_MS = 10_000;
const WATCHDOG_BOOT_GRACE_MS = 30_000;
// Group B: throttle DB writes to 10 Hz max. Buffer always tracks the
// most recent Binance trade; the flush interval picks it up. Caps
// `speed_oracle_ticks` growth at ~864k rows/day while keeping freshness
// well within the 2s execution-gate threshold.
const FLUSH_INTERVAL_MS = 100;

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

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: isRds ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[oracle] pg pool error:", err.message);
  reportFailure("pg-pool", err);
});

// Binance trade event payload from the @trade stream. One event per
// matched trade on Binance. Pushed at ~10-30/sec for BTC during normal
// hours, up to 100/sec during volatility.
interface BinanceTradeEvent {
  e: "trade";
  E: number;   // event time (ms)
  s: string;   // symbol
  t: number;   // trade id
  p: string;   // price
  q: string;   // quantity
  T: number;   // trade time (ms) — what we use for ts
  m: boolean;  // is buyer the market maker?
  M?: boolean; // ignore (deprecated)
}

interface BufferedTrade {
  price: number;
  binanceT: number; // Binance trade timestamp in ms
}

const state = {
  lastTickAt: 0,        // server clock when we last received a Binance event
  ticksSinceStart: 0,   // total Binance events received
  ticksSinceLastLog: 0, // events received since last heartbeat log
  flushesSinceStart: 0, // total DB writes (Binance events × throttle ratio)
  reconnectAttempts: 0,
  connectedAt: 0,
  lastError: null as string | null,
  ws: null as WebSocket | null,
  consecutiveWriteFailures: 0,
  lastSentryAlertAt: 0,
  // Group B: buffer the most recent Binance trade. The flush interval
  // (100ms / 10 Hz) picks it up. Cleared after each flush so we don't
  // re-write the same tick if no new trades arrive between flushes.
  buffer: null as BufferedTrade | null,
};

function reportFailure(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[oracle][${scope}] ${message}`);
  if (!SENTRY_DSN) return;
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

async function writeTick(trade: BufferedTrade): Promise<void> {
  const tsIso = new Date(trade.binanceT).toISOString();

  if (!Number.isFinite(trade.price) || trade.price <= 0) {
    console.warn("[oracle] skipping trade with invalid price:", trade);
    return;
  }

  // Two writes per flush:
  //   1. speed_oracle_ticks: append-only history (ON CONFLICT noop on
  //      (asset, ts, source) — unique index from mig 0008). Multiple
  //      flushes seeing the same Binance trade dedupe naturally because
  //      they share the same `T` timestamp.
  //   2. speed_oracle_latest: single-row cache, upsert by asset PK.
  //      received_at uses NOW() so the freshness gate measures observation
  //      time (not Binance event time, which can lag during congestion).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO speed_oracle_ticks (asset, ts, price, source)
       VALUES ($1, $2::timestamptz, $3::numeric, $4)
       ON CONFLICT (asset, ts, source) DO NOTHING`,
      [ASSET, tsIso, trade.price, SOURCE]
    );
    await client.query(
      `INSERT INTO speed_oracle_latest (asset, price, received_at)
       VALUES ($1, $2::numeric, NOW())
       ON CONFLICT (asset) DO UPDATE
         SET price = EXCLUDED.price,
             received_at = EXCLUDED.received_at`,
      [ASSET, trade.price]
    );
    await client.query("COMMIT");
    state.consecutiveWriteFailures = 0;
    state.flushesSinceStart++;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    state.lastError = err instanceof Error ? err.message : String(err);
    state.consecutiveWriteFailures += 1;
    console.error(
      `[oracle] write failure (${state.consecutiveWriteFailures} in a row): ${state.lastError}`
    );
    if (state.consecutiveWriteFailures === SUSTAINED_FAIL_THRESHOLD) {
      reportFailure("pg-write-sustained", err);
    }
  } finally {
    client.release();
  }
}

function connect(): void {
  console.log(
    `[oracle] connecting to ${STREAM_URL} (attempt ${state.reconnectAttempts + 1})`
  );
  const ws = new WebSocket(STREAM_URL);
  state.ws = ws;

  ws.on("open", () => {
    state.connectedAt = Date.now();
    state.reconnectAttempts = 0;
    console.log(
      `[oracle] connected at ${new Date(state.connectedAt).toISOString()}`
    );
  });

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString()) as BinanceTradeEvent;
      if (event.e !== "trade") return;
      const price = Number(event.p);
      if (!Number.isFinite(price) || price <= 0) return;
      state.lastTickAt = Date.now();
      state.ticksSinceStart++;
      state.ticksSinceLastLog++;
      // Group B: buffer the latest tick. The flush interval picks it up
      // at 10 Hz. If multiple trades arrive between flushes, only the
      // newest is persisted — for our use case (chart display + execution
      // freshness) only the newest matters.
      state.buffer = { price, binanceT: event.T };
    } catch (err) {
      console.error("[oracle] parse error:", err);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(
      `[oracle] disconnected code=${code} reason=${reason.toString()}`
    );
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[oracle] ws error:", err.message);
    state.lastError = `ws: ${err.message}`;
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

// Group B: 10 Hz flush loop. Pulls the most recent buffered Binance trade
// and writes it to RDS. Skips when no new trade has arrived since the last
// flush — `state.buffer` is set by the WS message handler and cleared after
// each successful flush, so we only write when there's fresh data.
setInterval(() => {
  const trade = state.buffer;
  if (!trade) return;
  state.buffer = null;
  void writeTick(trade);
}, FLUSH_INTERVAL_MS);

setInterval(() => {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const now = Date.now();

  if (state.lastTickAt === 0) {
    if (
      state.connectedAt > 0 &&
      now - state.connectedAt > WATCHDOG_BOOT_GRACE_MS
    ) {
      console.warn(
        `[oracle][watchdog] ${WATCHDOG_BOOT_GRACE_MS}ms since open with zero ticks — forcing reconnect`
      );
      reportFailure("watchdog-boot-no-ticks", new Error("boot grace exceeded"));
      ws.terminate();
    }
    return;
  }

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
    `[oracle] heartbeat: ${state.ticksSinceLastLog} binance events/min, ${state.flushesSinceStart} total flushes, last=${
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
    const ageSec = state.lastTickAt
      ? Math.floor((now - state.lastTickAt) / 1000)
      : null;
    const healthy =
      state.ws?.readyState === WebSocket.OPEN &&
      ageSec !== null &&
      ageSec < HEALTH_FRESHNESS_SEC;
    const body = JSON.stringify({
      healthy,
      connected: state.ws?.readyState === WebSocket.OPEN,
      last_tick_age_sec: ageSec,
      ticks_since_start: state.ticksSinceStart,
      flushes_since_start: state.flushesSinceStart,
      reconnect_attempts: state.reconnectAttempts,
      last_error: state.lastError,
      consecutive_write_failures: state.consecutiveWriteFailures,
      stream: STREAM_URL,
      flush_interval_ms: FLUSH_INTERVAL_MS,
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
  setTimeout(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  }, 1000);
});

connect();
