/**
 * Speed Oracle Worker — Sooq v2 (multi-asset: BTC + GOLD via PAXG)
 *
 * Streams Binance top-of-book updates via WebSocket and writes mid prices
 * (best_bid + best_ask)/2 directly to RDS PostgreSQL.
 *
 * Multi-asset (mig 0052 / Phase 5A):
 *   - BTC: btcusdt@bookTicker (always streaming)
 *   - GOLD: paxgusdt@bookTicker (only subscribed if speed_assets.GOLD.enabled
 *     = TRUE at startup; allows shipping the worker before activating gold)
 *   - Single combined-stream WebSocket: stream?streams=btcusdt@bookTicker/paxgusdt@bookTicker
 *
 * Stream history (BTC):
 *   * Group A: btcusdt@kline_1s (server-bucketed, stair-stepped chart)
 *   * Group B: btcusdt@trade ($0.01-$0.10 sawtooth from buyer/seller alternation)
 *   * Group C (current): btcusdt@bookTicker — mid is monotonic, derivatives standard
 *
 * Per-asset state in `assetState[asset]`. Buffer + watchdog + write loop all
 * iterate over enabled assets. Single WebSocket connection serves all.
 *
 * Schema (mig 0052):
 *   * speed_oracle_ticks: per-asset history. ON CONFLICT noop on (asset, ts, source).
 *   * speed_oracle_latest: per-asset PK upsert.
 *   * speed_volatility_cache: per-(asset, horizon) realized vol.
 *
 * Reconnect: exponential backoff capped at 30s.
 * Watchdog: per-asset zombie detection.
 * Health: GET /health reports per-asset stale-detection.
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

const DATABASE_URL = RAW_DATABASE_URL.replace(
  /([?&])sslmode=[^&]+(&|$)/i,
  (_match, prefix, suffix) => (suffix === "&" ? prefix : "")
);
const isRds = DATABASE_URL.includes("rds.amazonaws.com");

console.log(
  `[oracle] PORT=${PORT}, has_db_url=${!!RAW_DATABASE_URL}, has_sentry=${!!SENTRY_DSN}, ssl=${isRds ? "on (no cert verify)" : "off"}`
);

// ────────────────────────────────────────────────────────────────────
// Asset routing
// ────────────────────────────────────────────────────────────────────
//
// Mapping from Binance stream symbol (lowercase) to our asset code.
// Add new assets here when the corresponding row exists in speed_assets
// and the @bookTicker stream is supported.

const SOURCE = "binance";

interface AssetSubscription {
  asset: string;            // our internal asset code, e.g. "BTC"
  streamSymbol: string;     // Binance lowercase symbol, e.g. "btcusdt"
  enabled: boolean;         // resolved at startup from speed_assets.enabled
}

const ALL_SUBSCRIPTIONS: ReadonlyArray<Omit<AssetSubscription, "enabled">> = [
  { asset: "BTC",  streamSymbol: "btcusdt"  },
  { asset: "GOLD", streamSymbol: "paxgusdt" },
];

// Resolved at startup. Gold subscription only added if speed_assets.GOLD.enabled = TRUE.
let activeSubscriptions: AssetSubscription[] = [];

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_LOG_EVERY_MS = 60_000;
const HEALTH_FRESHNESS_SEC = 2;
const SUSTAINED_FAIL_THRESHOLD = 30;
const WATCHDOG_INTERVAL_MS = 5_000;
const WATCHDOG_TICK_TIMEOUT_MS = 10_000;
const WATCHDOG_BOOT_GRACE_MS = 30_000;
const FLUSH_INTERVAL_MS = 100;

// RV cache writer (mig 0029) — runs per asset.
const RV_INTERVAL_MS = 5_000;
const RV_HORIZONS = [
  { label: "5m",  windowSeconds: 5 * 60 },
  { label: "15m", windowSeconds: 15 * 60 },
  { label: "1h",  windowSeconds: 60 * 60 },
  { label: "24h", windowSeconds: 24 * 60 * 60 },
] as const;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
const RV_EWMA_WEIGHTS: Record<string, number> = {
  "5m":  0.50,
  "15m": 0.25,
  "1h":  0.15,
  "24h": 0.10,
};
const RV_MIN_SAMPLES = 20;
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

interface BufferedTrade {
  price: number;
  binanceT: number;
}

interface AssetState {
  lastTickAt: number;
  ticksSinceStart: number;
  ticksSinceLastLog: number;
  flushesSinceStart: number;
  consecutiveWriteFailures: number;
  buffer: BufferedTrade | null;
}

// Per-asset state map. Populated at startup based on activeSubscriptions.
const assetState: Record<string, AssetState> = {};

// Connection-level state
const connState = {
  reconnectAttempts: 0,
  connectedAt: 0,
  lastError: null as string | null,
  ws: null as WebSocket | null,
  lastSentryAlertAt: 0,
};

function reportFailure(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[oracle][${scope}] ${message}`);
  if (!SENTRY_DSN) return;
  const now = Date.now();
  if (now - connState.lastSentryAlertAt < 60_000) return;
  connState.lastSentryAlertAt = now;
  Sentry.captureMessage(`speed-oracle: ${scope} — ${message}`, {
    level: "error",
    tags: { service: "speed-oracle", scope },
    extra: {
      reconnect_attempts: connState.reconnectAttempts,
      assets: activeSubscriptions.map((s) => s.asset),
    },
  });
}

function backoffMs(): number {
  const attempt = Math.min(connState.reconnectAttempts, 10);
  const ms = Math.min(RECONNECT_MIN_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
  return ms + Math.floor(Math.random() * 500);
}

// ────────────────────────────────────────────────────────────────────
// Startup: resolve which assets to subscribe to
// ────────────────────────────────────────────────────────────────────
//
// Reads speed_assets.enabled at startup. If GOLD.enabled = FALSE, the
// PAXG subscription is skipped entirely. This lets us deploy the worker
// code before activating gold trading. To activate gold:
//   1. UPDATE speed_assets SET enabled=TRUE WHERE id='GOLD';
//   2. systemctl restart speed-oracle.service
// (or use the deploy script which restarts the service on every push)

async function resolveSubscriptions(): Promise<void> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ id: string; enabled: boolean }>(
      `SELECT id, enabled FROM speed_assets WHERE id = ANY($1::text[])`,
      [ALL_SUBSCRIPTIONS.map((s) => s.asset)]
    );
    const enabledMap = new Map(r.rows.map((row) => [row.id, row.enabled]));

    activeSubscriptions = ALL_SUBSCRIPTIONS
      .map((s) => ({ ...s, enabled: enabledMap.get(s.asset) ?? false }))
      .filter((s) => s.enabled);

    if (activeSubscriptions.length === 0) {
      console.error("[oracle] FATAL: no enabled assets in speed_assets table");
      process.exit(1);
    }

    // Initialize per-asset state
    for (const sub of activeSubscriptions) {
      assetState[sub.asset] = {
        lastTickAt: 0,
        ticksSinceStart: 0,
        ticksSinceLastLog: 0,
        flushesSinceStart: 0,
        consecutiveWriteFailures: 0,
        buffer: null,
      };
    }

    console.log(
      `[oracle] enabled assets: ${activeSubscriptions.map((s) => `${s.asset}(${s.streamSymbol})`).join(", ")}`
    );
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────────────────────────
// Realized volatility writer (per asset)
// ────────────────────────────────────────────────────────────────────

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

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) /
    Math.max(1, returns.length - 1);
  const sigmaPerTick = Math.sqrt(variance);

  const dtSeconds = windowSeconds / returns.length;
  const sigmaAnnualized = sigmaPerTick * Math.sqrt(SECONDS_PER_YEAR / dtSeconds);

  return {
    sigmaAnnualized: clampSigma(sigmaAnnualized),
    sampleCount: returns.length,
  };
}

async function writeRvSnapshotForAsset(asset: string): Promise<void> {
  if (assetState[asset].lastTickAt === 0) return;

  const client = await pool.connect();
  try {
    const summaries: RvSummary[] = [];
    for (const horizon of RV_HORIZONS) {
      const rv = await computeRvForHorizon(client, asset, horizon.windowSeconds);
      if (rv) {
        summaries.push({
          horizonLabel: horizon.label,
          windowSeconds: horizon.windowSeconds,
          sigmaAnnualized: rv.sigmaAnnualized,
          sampleCount: rv.sampleCount,
        });
      }
    }

    if (summaries.length === 0) return;

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
        [asset, s.horizonLabel, s.sigmaAnnualized.toFixed(6), s.sampleCount]
      );
    }
    if (ewmaSigma !== null) {
      const totalSamples = summaries.reduce((a, b) => a + b.sampleCount, 0);
      await client.query(
        `INSERT INTO speed_volatility_cache
           (asset, horizon, sigma_annualized, sample_count, computed_at)
         VALUES ($1, 'ewma', $2::numeric, $3, NOW())
         ON CONFLICT (asset, horizon) DO UPDATE
           SET sigma_annualized = EXCLUDED.sigma_annualized,
               sample_count = EXCLUDED.sample_count,
               computed_at = EXCLUDED.computed_at`,
        [asset, ewmaSigma.toFixed(6), totalSamples]
      );
    }
    await client.query("COMMIT");

    const summary = summaries
      .map((s) => `${s.horizonLabel}=${(s.sigmaAnnualized * 100).toFixed(2)}%`)
      .join(" ");
    const ewmaLog = ewmaSigma !== null
      ? ` ewma=${(ewmaSigma * 100).toFixed(2)}%`
      : "";
    console.log(`[oracle][rv][${asset}] ${summary}${ewmaLog}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[oracle][rv][${asset}] write failed: ${msg}`);
    reportFailure(`rv-write-${asset}`, err);
  } finally {
    client.release();
  }
}

async function writeAllRvSnapshots(): Promise<void> {
  for (const sub of activeSubscriptions) {
    await writeRvSnapshotForAsset(sub.asset);
  }
}

// ────────────────────────────────────────────────────────────────────
// Tick writer (per asset)
// ────────────────────────────────────────────────────────────────────

async function writeTick(asset: string, trade: BufferedTrade): Promise<void> {
  const tsIso = new Date(trade.binanceT).toISOString();

  if (!Number.isFinite(trade.price) || trade.price <= 0) {
    console.warn(`[oracle][${asset}] skipping invalid price:`, trade);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO speed_oracle_ticks (asset, ts, price, source)
       VALUES ($1, $2::timestamptz, $3::numeric, $4)
       ON CONFLICT (asset, ts, source) DO NOTHING`,
      [asset, tsIso, trade.price, SOURCE]
    );
    await client.query(
      `INSERT INTO speed_oracle_latest (asset, price, received_at)
       VALUES ($1, $2::numeric, NOW())
       ON CONFLICT (asset) DO UPDATE
         SET price = EXCLUDED.price,
             received_at = EXCLUDED.received_at`,
      [asset, trade.price]
    );
    await client.query("COMMIT");
    assetState[asset].consecutiveWriteFailures = 0;
    assetState[asset].flushesSinceStart++;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    connState.lastError = err instanceof Error ? err.message : String(err);
    assetState[asset].consecutiveWriteFailures += 1;
    console.error(
      `[oracle][${asset}] write failure (${assetState[asset].consecutiveWriteFailures} in a row): ${connState.lastError}`
    );
    if (assetState[asset].consecutiveWriteFailures === SUSTAINED_FAIL_THRESHOLD) {
      reportFailure(`pg-write-sustained-${asset}`, err);
    }
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────────────────────────
// WebSocket connection (single, combined-stream)
// ────────────────────────────────────────────────────────────────────
//
// Combined stream URL: wss://stream.binance.com:9443/stream?streams=A/B/C
// Wraps each event in {stream, data}. We route data.b/data.a by stream name.

function buildStreamUrl(): string {
  const streams = activeSubscriptions
    .map((s) => `${s.streamSymbol}@bookTicker`)
    .join("/");
  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

interface BinanceCombinedEvent {
  stream: string;
  data: {
    u: number;
    s: string;
    b: string;
    B: string;
    a: string;
    A: string;
  };
}

function streamToAsset(streamName: string): string | null {
  const symbol = streamName.replace("@bookTicker", "");
  const sub = activeSubscriptions.find((s) => s.streamSymbol === symbol);
  return sub ? sub.asset : null;
}

function connect(): void {
  const url = buildStreamUrl();
  console.log(`[oracle] connecting to ${url} (attempt ${connState.reconnectAttempts + 1})`);
  const ws = new WebSocket(url);
  connState.ws = ws;

  ws.on("open", () => {
    connState.connectedAt = Date.now();
    connState.reconnectAttempts = 0;
    console.log(`[oracle] connected at ${new Date(connState.connectedAt).toISOString()}`);
  });

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString()) as BinanceCombinedEvent;
      if (!event || !event.stream || !event.data) return;
      const asset = streamToAsset(event.stream);
      if (!asset) return;
      const inner = event.data;
      if (typeof inner.b !== "string" || typeof inner.a !== "string") return;

      const bid = Number(inner.b);
      const ask = Number(inner.a);
      if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0 ||
        ask < bid
      ) {
        return;
      }
      // Round mid to a stable per-asset precision. BTC: 2 decimals (cents).
      // GOLD/PAXG: 3 decimals (millicents) — more precision because moves
      // are smaller in absolute terms.
      const decimals = asset === "GOLD" ? 3 : 2;
      const factor = Math.pow(10, decimals);
      const mid = Math.round(((bid + ask) / 2) * factor) / factor;
      const now = Date.now();
      assetState[asset].lastTickAt = now;
      assetState[asset].ticksSinceStart++;
      assetState[asset].ticksSinceLastLog++;
      assetState[asset].buffer = { price: mid, binanceT: now };
    } catch (err) {
      console.error("[oracle] parse error:", err);
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`[oracle] disconnected code=${code} reason=${reason.toString()}`);
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[oracle] ws error:", err.message);
    connState.lastError = `ws: ${err.message}`;
    if (connState.reconnectAttempts >= 5) {
      reportFailure("ws-reconnect-stuck", err);
    }
  });
}

function scheduleReconnect(): void {
  const delay = backoffMs();
  connState.reconnectAttempts++;
  console.log(`[oracle] reconnecting in ${delay}ms`);
  setTimeout(() => connect(), delay);
}

// ────────────────────────────────────────────────────────────────────
// Boot sequence
// ────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  await resolveSubscriptions();

  // Per-asset flush loop: pulls each asset's buffered tick and writes
  setInterval(() => {
    for (const sub of activeSubscriptions) {
      const trade = assetState[sub.asset].buffer;
      if (!trade) continue;
      assetState[sub.asset].buffer = null;
      void writeTick(sub.asset, trade);
    }
  }, FLUSH_INTERVAL_MS);

  // Per-asset RV writer
  setInterval(() => {
    void writeAllRvSnapshots();
  }, RV_INTERVAL_MS);

  // Per-asset watchdog
  setInterval(() => {
    const ws = connState.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();

    for (const sub of activeSubscriptions) {
      const state = assetState[sub.asset];
      if (state.lastTickAt === 0) {
        if (
          connState.connectedAt > 0 &&
          now - connState.connectedAt > WATCHDOG_BOOT_GRACE_MS
        ) {
          console.warn(
            `[oracle][watchdog][${sub.asset}] ${WATCHDOG_BOOT_GRACE_MS}ms since open with zero ticks`
          );
          // Don't terminate yet — other assets may be flowing fine
        }
        continue;
      }

      const sinceLastTick = now - state.lastTickAt;
      // PAXG can have legitimate gaps during off-hours; bump timeout for low-vol assets.
      // Matches speed_asset_config.GOLD.oracle_stale_seconds = 30 (mig 0052) so the
      // worker reconnect threshold and DB-side trade-rejection threshold align.
      const timeoutMs = sub.asset === "GOLD" ? 30_000 : WATCHDOG_TICK_TIMEOUT_MS;
      if (sinceLastTick > timeoutMs) {
        console.warn(
          `[oracle][watchdog][${sub.asset}] no ticks for ${sinceLastTick}ms — forcing reconnect`
        );
        reportFailure(
          `watchdog-zombie-${sub.asset}`,
          new Error(`no ticks for ${sinceLastTick}ms`)
        );
        ws.terminate();
        return;
      }
    }
  }, WATCHDOG_INTERVAL_MS);

  // Heartbeat log per asset
  setInterval(() => {
    const lines: string[] = [];
    for (const sub of activeSubscriptions) {
      const state = assetState[sub.asset];
      if (state.ticksSinceLastLog === 0) continue;
      lines.push(
        `${sub.asset}=${state.ticksSinceLastLog}/min, ${state.flushesSinceStart} flushes`
      );
      state.ticksSinceLastLog = 0;
    }
    if (lines.length > 0) {
      console.log(`[oracle] heartbeat: ${lines.join(" | ")}`);
    }
  }, HEARTBEAT_LOG_EVERY_MS);

  // Health endpoint
  http
    .createServer((req, res) => {
      if (req.url !== "/health") {
        res.writeHead(404).end();
        return;
      }
      const now = Date.now();
      const perAsset: Record<string, unknown> = {};
      let allHealthy = connState.ws?.readyState === WebSocket.OPEN;

      for (const sub of activeSubscriptions) {
        const state = assetState[sub.asset];
        const ageSec = state.lastTickAt
          ? Math.floor((now - state.lastTickAt) / 1000)
          : null;
        // Gold gets 30s tolerance vs 2s for BTC (matches the per-asset
        // oracle_stale_seconds in speed_asset_config from mig 0052).
        const freshnessThresh = sub.asset === "GOLD" ? 30 : HEALTH_FRESHNESS_SEC;
        const healthy = ageSec !== null && ageSec < freshnessThresh;
        if (!healthy) allHealthy = false;
        perAsset[sub.asset] = {
          healthy,
          last_tick_age_sec: ageSec,
          ticks_since_start: state.ticksSinceStart,
          flushes_since_start: state.flushesSinceStart,
          consecutive_write_failures: state.consecutiveWriteFailures,
        };
      }

      const body = JSON.stringify({
        healthy: allHealthy,
        connected: connState.ws?.readyState === WebSocket.OPEN,
        reconnect_attempts: connState.reconnectAttempts,
        last_error: connState.lastError,
        per_asset: perAsset,
        flush_interval_ms: FLUSH_INTERVAL_MS,
      });
      res.writeHead(allHealthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(body);
    })
    .listen(PORT, "0.0.0.0", () => {
      console.log(`[oracle] health endpoint on 0.0.0.0:${PORT}/health`);
    });

  process.on("SIGTERM", () => {
    console.log("[oracle] SIGTERM received, closing");
    connState.ws?.close(1000, "shutdown");
    setTimeout(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    }, 1000);
  });

  // Connect last so the message handler exists when first messages arrive
  connect();
}

void boot().catch((err) => {
  console.error("[oracle] FATAL boot error:", err);
  process.exit(1);
});
