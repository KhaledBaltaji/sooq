/**
 * Speed Oracle Worker — Sooq v1
 *
 * Streams Binance BTC/USDT 1-second klines via WebSocket and writes them
 * directly to RDS PostgreSQL via the `pg` driver. Single persistent
 * Node process — running >1 replica races the speed_oracle_latest upsert.
 *
 * Schema differences vs prediction-market era:
 *   * `speed_oracle_klines` table doesn't exist in the slim Sooq schema
 *     → only writes `speed_oracle_ticks` (synthesized: price = kline.close,
 *     ts = kline.t) and upserts `speed_oracle_latest` (live tail cache).
 *     The chart RPC `get_speed_klines` synthesizes OHLC from the tick
 *     stream at read time (mig 0007).
 *   * Drizzle/RDS instead of supabase-js. Connection sources from
 *     DATABASE_URL exactly the same way as the Next app's pg pool.
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
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_LOG_EVERY_MS = 60_000;
const HEALTH_FRESHNESS_SEC = 2;
const SUSTAINED_FAIL_THRESHOLD = 30;
const WATCHDOG_INTERVAL_MS = 5_000;
const WATCHDOG_TICK_TIMEOUT_MS = 10_000;
const WATCHDOG_BOOT_GRACE_MS = 30_000;

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

interface BinanceKlineEvent {
  e: "kline";
  E: number;
  s: string;
  k: {
    t: number; // open ms
    T: number; // close ms
    s: string;
    i: string;
    f: number;
    L: number;
    o: string; // open
    c: string; // close
    h: string; // high
    l: string; // low
    v: string;
    n: number;
    x: boolean; // closed?
    q: string;
    V: string;
    Q: string;
    B: string;
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

async function writeTick(kline: BinanceKlineEvent["k"]): Promise<void> {
  const tsIso = new Date(kline.t).toISOString();
  const closePrice = Number(kline.c);

  if (!Number.isFinite(closePrice) || closePrice <= 0) {
    console.warn("[oracle] skipping kline with invalid close:", kline);
    return;
  }

  // Two writes per closed kline:
  //   1. speed_oracle_ticks: append-only history (ON CONFLICT noop on
  //      (asset, ts, source) — unique index from mig 0008).
  //   2. speed_oracle_latest: single-row cache, upsert by asset PK.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO speed_oracle_ticks (asset, ts, price, source)
       VALUES ($1, $2::timestamptz, $3::numeric, $4)
       ON CONFLICT (asset, ts, source) DO NOTHING`,
      [ASSET, tsIso, closePrice, SOURCE]
    );
    await client.query(
      `INSERT INTO speed_oracle_latest (asset, price, received_at)
       VALUES ($1, $2::numeric, NOW())
       ON CONFLICT (asset) DO UPDATE
         SET price = EXCLUDED.price,
             received_at = EXCLUDED.received_at`,
      [ASSET, closePrice]
    );
    await client.query("COMMIT");
    state.consecutiveWriteFailures = 0;
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
      const event = JSON.parse(data.toString()) as BinanceKlineEvent;
      if (event.e !== "kline") return;
      if (!event.k?.x) return; // skip in-progress, only persist closed
      state.lastTickAt = Date.now();
      state.ticksSinceStart++;
      state.ticksSinceLastLog++;
      void writeTick(event.k);
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
      reconnect_attempts: state.reconnectAttempts,
      last_error: state.lastError,
      consecutive_write_failures: state.consecutiveWriteFailures,
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
