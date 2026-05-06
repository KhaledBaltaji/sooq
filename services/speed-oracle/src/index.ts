/**
 * Speed Oracle Worker — Sooq v1 (Group C: chart smoothness)
 *
 * Streams Binance BTC/USDT top-of-book updates via WebSocket and writes
 * the mid price (best_bid + best_ask)/2 directly to RDS PostgreSQL via
 * the `pg` driver. Single persistent Node process — running >1 replica
 * races the speed_oracle_latest upsert.
 *
 * Stream history:
 *   * Group A (initial): `btcusdt@kline_1s` — one event/sec, server-bucketed.
 *     Smooth but noticeably stair-stepped on a CFD-style chart.
 *   * Group B: `btcusdt@trade` — one event per matched trade (10–300/sec
 *     for BTC). Higher granularity but consecutive prints alternate
 *     buyer-/seller-initiated, producing a $0.01–$0.10 sawtooth that
 *     showed up as visible "bouncing" on the chart even on calm markets.
 *   * Group C (current): `btcusdt@bookTicker` — emits whenever best bid
 *     OR best ask changes (~200–500/sec for BTCUSDT). We compute mid =
 *     (bid + ask)/2 and persist that. Mid is monotonically driven by
 *     real flow, doesn't alternate, and is the standard reference price
 *     for derivatives.
 *
 * Throttling: writes are flushed at most every FLUSH_INTERVAL_MS to RDS
 * (default 100ms = 10 Hz). The buffered `state.buffer` is always the
 * most recent mid observed; the flush interval picks it up and writes
 * one row per flush. This caps RDS write load while still giving
 * sub-second tick granularity for the wick detector and keeping
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
// Group C: switched from @trade → @bookTicker. We now write the mid
// (best_bid + best_ask) / 2 as our reference price. Reasons:
//  • @trade alternates buyer-/seller-initiated prints, so consecutive
//    prices zigzag by spread amount ($0.01–$0.10 on BTCUSDT). That
//    sawtooth showed up in the chart as "bouncing" even on calm markets.
//  • Mid is monotonically driven by real flow — no alternation. It's
//    also the industry-standard reference price for derivatives.
//  • Volume is similar/higher (~200–500 events/sec for BTCUSDT) but the
//    100ms flush throttle absorbs that just like before.
//  • The wick detector threshold (mig 0017 raised 0.001 → 0.003 to
//    absorb @trade noise) is dropped back to 0.0015 in mig 0018 since
//    mid is much quieter.
const STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@bookTicker";
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

// Mig 0029: realized volatility cache. Computed from speed_oracle_ticks
// at multiple horizons, written to speed_volatility_cache. Read by
// _speed_get_iv() inside speed_execute_trade and speed_execute_cashout.
//
// Cadence: 5s. Codex review caught this: 30s cadence vs the 5m freshness
// gate of 10s left a 20s window every 30s where the cache was stale and
// (under fail-closed) the trade RPC would reject. 5s cadence + 30s
// freshness for 5m gives us 6× headroom.
const RV_INTERVAL_MS = 5_000;
const RV_HORIZONS = [
  { label: "5m",  windowSeconds: 5 * 60 },
  { label: "15m", windowSeconds: 15 * 60 },
  { label: "1h",  windowSeconds: 60 * 60 },
  { label: "24h", windowSeconds: 24 * 60 * 60 },
] as const;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
// EWMA blend weights. Newer horizons weighted higher; sums to 1.
// 5m: 50%, 15m: 25%, 1h: 15%, 24h: 10%. Tunable; current values err
// toward responsiveness over stability for fast-cycle markets.
const RV_EWMA_WEIGHTS: Record<string, number> = {
  "5m":  0.50,
  "15m": 0.25,
  "1h":  0.15,
  "24h": 0.10,
};
// Min sample count to publish a horizon. Below this, we have too few
// data points for sigma to be meaningful — skip the write.
const RV_MIN_SAMPLES = 20;
// Floor / ceiling for sigma_annualized matching the CHECK constraint
// in mig 0029. Out-of-range gets clamped to the nearest bound (rather
// than rejected) so we don't drop the row entirely on calm markets.
const RV_SIGMA_FLOOR = 0.05;
const RV_SIGMA_CEILING = 2.0;

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

// Binance bookTicker event payload from the @bookTicker stream.
// Emitted whenever the best bid OR best ask changes — typically
// 200–500 events/sec for BTCUSDT. Note: the @bookTicker stream does
// NOT include an event timestamp; we use server receive-time. The
// difference vs. Binance-side time is sub-10ms — well inside the 100ms
// flush throttle and the 2s execution-gate freshness threshold.
interface BinanceBookTickerEvent {
  u: number;   // order book updateId
  s: string;   // symbol
  b: string;   // best bid price
  B: string;   // best bid qty
  a: string;   // best ask price
  A: string;   // best ask qty
}

interface BufferedTrade {
  price: number;   // mid = (bid + ask) / 2
  binanceT: number; // server receive-time in ms (bookTicker has no event time)
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

// ────────────────────────────────────────────────────────────────────
// Mig 0029: realized volatility writer
// ────────────────────────────────────────────────────────────────────
//
// Pulls the last `windowSeconds` of ticks for an asset, computes the
// standard deviation of per-tick log returns, and scales to annualized
// sigma using the per-tick interval (NOT the window length).
//
// Math (corrected per Codex review):
//   For N ticks at average interval dt = window/(N-1):
//     log_return_i = ln(p_{i+1} / p_i)         (N-1 returns)
//     sigma_per_tick = stddev(log_returns)     (per-tick volatility)
//     sigma_annualized = sigma_per_tick * sqrt(SECONDS_PER_YEAR / dt)
//
// Why per-tick, not per-window: stddev of log_returns measures the
// volatility of a single ~100ms interval, not the volatility over the
// whole window. To annualize, scale by sqrt(year_seconds / dt). The
// previous formula sqrt(year/window) understated vol by sqrt(N), which
// at 10Hz over 5m is ~55× — would have replaced "stuck at 0.60" with
// "stuck near 0.05 floor".
//
// Brownian assumption: log returns are i.i.d. with constant per-second
// variance σ². Then variance over dt seconds is σ²·dt, so stddev over
// dt is σ·√dt = sigma_per_tick. Solving: σ = sigma_per_tick / √dt =
// sigma_per_tick · √(1/dt). Annualizing to 1 year of seconds: σ_year =
// σ · √year_seconds = sigma_per_tick · √(year_seconds / dt). ✓

interface RvSummary {
  horizonLabel: string;
  windowSeconds: number;
  sigmaAnnualized: number;
  sampleCount: number;
}

function clampSigma(sigma: number): number {
  if (!Number.isFinite(sigma) || sigma <= 0) return RV_SIGMA_FLOOR;
  if (sigma < RV_SIGMA_FLOOR) return RV_SIGMA_FLOOR;
  if (sigma > RV_SIGMA_CEILING) return RV_SIGMA_CEILING;
  return sigma;
}

async function computeRvForHorizon(
  client: import("pg").PoolClient,
  asset: string,
  windowSeconds: number
): Promise<{ sigmaAnnualized: number; sampleCount: number } | null> {
  // Fetch ticks ordered by ts. The unique index on (asset, ts, source)
  // means duplicates are already deduped at write time.
  const result = await client.query<{ price: string }>(
    `SELECT price::text AS price
       FROM speed_oracle_ticks
      WHERE asset = $1
        AND ts > NOW() - ($2 || ' seconds')::interval
      ORDER BY ts ASC`,
    [asset, windowSeconds]
  );

  const n = result.rows.length;
  if (n < RV_MIN_SAMPLES) return null;

  // Compute log returns between consecutive ticks.
  const returns: number[] = [];
  let prevPrice = Number(result.rows[0].price);
  for (let i = 1; i < n; i++) {
    const p = Number(result.rows[i].price);
    if (p > 0 && prevPrice > 0) {
      returns.push(Math.log(p / prevPrice));
    }
    prevPrice = p;
  }
  if (returns.length < RV_MIN_SAMPLES) return null;

  // Sample standard deviation (n-1 denominator) of per-tick log returns.
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) /
    Math.max(1, returns.length - 1);
  const sigmaPerTick = Math.sqrt(variance);

  // Annualize using the AVERAGE per-tick interval (not the window length).
  // dt = window_seconds / N_returns. Then sigma_annualized =
  // sigma_per_tick × sqrt(year_seconds / dt). Equivalent to
  // sigma_per_tick × sqrt(year_seconds × N_returns / window_seconds).
  const dtSeconds = windowSeconds / returns.length;
  const sigmaAnnualized = sigmaPerTick * Math.sqrt(SECONDS_PER_YEAR / dtSeconds);

  return {
    sigmaAnnualized: clampSigma(sigmaAnnualized),
    sampleCount: returns.length,
  };
}

async function writeRvSnapshot(): Promise<void> {
  // Skip if buffer is empty (no ticks at all yet).
  if (state.lastTickAt === 0) return;

  const client = await pool.connect();
  try {
    const summaries: RvSummary[] = [];
    for (const horizon of RV_HORIZONS) {
      const rv = await computeRvForHorizon(client, ASSET, horizon.windowSeconds);
      if (rv) {
        summaries.push({
          horizonLabel: horizon.label,
          windowSeconds: horizon.windowSeconds,
          sigmaAnnualized: rv.sigmaAnnualized,
          sampleCount: rv.sampleCount,
        });
      }
    }

    if (summaries.length === 0) {
      // Not enough data yet (cold start, recent restart, gap). Skip.
      return;
    }

    // Compute EWMA blend if all four horizons present. Skip otherwise.
    let ewmaSigma: number | null = null;
    if (summaries.length === RV_HORIZONS.length) {
      let weighted = 0;
      let weightSum = 0;
      for (const s of summaries) {
        const w = RV_EWMA_WEIGHTS[s.horizonLabel] ?? 0;
        weighted += s.sigmaAnnualized * w;
        weightSum += w;
      }
      if (weightSum > 0) {
        ewmaSigma = clampSigma(weighted / weightSum);
      }
    }

    // Upsert all horizons in one transaction.
    await client.query("BEGIN");
    for (const s of summaries) {
      await client.query(
        `INSERT INTO speed_volatility_cache
           (asset, horizon, sigma_annualized, sample_count, computed_at)
         VALUES ($1, $2, $3::numeric, $4, NOW())
         ON CONFLICT (asset, horizon) DO UPDATE
           SET sigma_annualized = EXCLUDED.sigma_annualized,
               sample_count = EXCLUDED.sample_count,
               computed_at = EXCLUDED.computed_at`,
        [ASSET, s.horizonLabel, s.sigmaAnnualized.toFixed(6), s.sampleCount]
      );
    }
    if (ewmaSigma !== null) {
      // EWMA row uses sample_count = sum of horizon samples for visibility.
      const totalSamples = summaries.reduce((a, b) => a + b.sampleCount, 0);
      await client.query(
        `INSERT INTO speed_volatility_cache
           (asset, horizon, sigma_annualized, sample_count, computed_at)
         VALUES ($1, 'ewma', $2::numeric, $3, NOW())
         ON CONFLICT (asset, horizon) DO UPDATE
           SET sigma_annualized = EXCLUDED.sigma_annualized,
               sample_count = EXCLUDED.sample_count,
               computed_at = EXCLUDED.computed_at`,
        [ASSET, ewmaSigma.toFixed(6), totalSamples]
      );
    }
    await client.query("COMMIT");

    // Heartbeat log every RV write so we can spot-check from the EC2 logs.
    const summary = summaries
      .map((s) => `${s.horizonLabel}=${(s.sigmaAnnualized * 100).toFixed(2)}%`)
      .join(" ");
    const ewmaLog = ewmaSigma !== null
      ? ` ewma=${(ewmaSigma * 100).toFixed(2)}%`
      : "";
    console.log(`[oracle][rv] ${summary}${ewmaLog}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[oracle][rv] write failed: ${msg}`);
    reportFailure("rv-write", err);
  } finally {
    client.release();
  }
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
      const event = JSON.parse(data.toString()) as BinanceBookTickerEvent;
      // bookTicker events always have b/a fields. If shape is wrong,
      // skip silently (could be a stray combined-stream control message).
      if (!event || typeof event.b !== "string" || typeof event.a !== "string") return;
      const bid = Number(event.b);
      const ask = Number(event.a);
      if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0 ||
        ask < bid
      ) {
        return;
      }
      // Group C+ cleanup: round mid to the nearest cent at the source.
      // BTCUSDT spread is typically $0.01, so raw mid sits at a half-cent
      // (e.g. 79754.785). When stored at numeric precision and rounded to
      // 2 decimals for display, every other tick flips between $79754.78
      // and $79754.79 — visible on the chart as a $0.01 sawtooth on the
      // line endpoint. Rounding to the cent here gives us a stable value
      // until the underlying bid OR ask actually moves by ≥ $0.01. The
      // line stops twitching when nothing real is happening.
      const mid = Math.round(((bid + ask) / 2) * 100) / 100;
      const now = Date.now();
      state.lastTickAt = now;
      state.ticksSinceStart++;
      state.ticksSinceLastLog++;
      // Group C: buffer the mid. The flush interval (100ms) picks it up.
      // Multiple bookTicker events between flushes collapse — only the
      // newest mid is persisted, which is correct: we want the most
      // recent reference price for chart display + execution freshness.
      state.buffer = { price: mid, binanceT: now };
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

// Mig 0029: realized volatility cache writer. 30s cadence — fast enough
// that the helper's 10s/30s freshness gates stay green between writes,
// slow enough that we don't load the DB with redundant computation.
// Skips when no ticks have arrived (lastTickAt === 0) or when a horizon
// has insufficient samples.
setInterval(() => {
  void writeRvSnapshot();
}, RV_INTERVAL_MS);

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
