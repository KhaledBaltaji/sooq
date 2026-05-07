#!/usr/bin/env node
// Recalibrate pricing matrix from rolling 14-day window (mig 0034 / pricing v3)
//
// Run modes:
//   node scripts/recalibrate-pricing-matrix.mjs --asset BTC --duration 5m
//   node scripts/recalibrate-pricing-matrix.mjs --dry-run                   (compute but don't write)
//   node scripts/recalibrate-pricing-matrix.mjs --force                     (skip property tests)
//
// Behavior:
//   1. Pull resolved markets from rolling window (default 14 days)
//   2. Sample 1 tick/second per market during open window
//   3. Bucket by (dist_pct, seconds_left)
//   4. For each cell:
//      - Raw empirical p_over = mean(outcome == 'over')
//      - Effective N = COUNT(DISTINCT market_id) — codex critical fix (per-market, not per-tick)
//      - Bayesian shrinkage toward neutral 0.5 prior with weight = speed_pricing_matrix_prior_n
//      - Jeffreys binomial CI: Beta(wins+0.5, losses+0.5)
//   5. Apply isotonic regression per time bucket to enforce monotonicity in distance
//   6. Property tests: monotone in dist (each time bucket), values in [0,1], no NaN
//   7. Insert new version row + cells, mark active if tests pass
//
// Reused as both:
//   - One-shot seed before applying migration 0034
//   - Nightly cron (scheduled via Vercel cron or pg_cron)

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const ASSET = flagValue("--asset") || "BTC";
const DURATION = flagValue("--duration") || "5m"; // 5m only in v1; 1h deferred until ≥200 markets
const WINDOW_DAYS = parseInt(flagValue("--window-days") || "14", 10);
const DRY_RUN = flag("--dry-run");
const FORCE = flag("--force"); // skip property test gate
const VERBOSE = flag("--verbose") || flag("-v");

// Distance buckets (% from strike). Tuned for 5m volatility profile.
const DIST_BUCKETS = [
  { idx: 0, lo: -Infinity, hi: -0.005, label: "<= -0.5%" },
  { idx: 1, lo: -0.005, hi: -0.003, label: "-0.5..-0.3%" },
  { idx: 2, lo: -0.003, hi: -0.002, label: "-0.3..-0.2%" },
  { idx: 3, lo: -0.002, hi: -0.001, label: "-0.2..-0.1%" },
  { idx: 4, lo: -0.001, hi: -0.0005, label: "-0.1..-0.05%" },
  { idx: 5, lo: -0.0005, hi: 0, label: "-0.05..0%" },
  { idx: 6, lo: 0, hi: 0.0005, label: "0..+0.05%" },
  { idx: 7, lo: 0.0005, hi: 0.001, label: "+0.05..+0.1%" },
  { idx: 8, lo: 0.001, hi: 0.002, label: "+0.1..+0.2%" },
  { idx: 9, lo: 0.002, hi: 0.003, label: "+0.2..+0.3%" },
  { idx: 10, lo: 0.003, hi: 0.005, label: "+0.3..+0.5%" },
  { idx: 11, lo: 0.005, hi: Infinity, label: ">= +0.5%" },
];

// Time buckets (seconds left). Coarser at the long end, fine near expiry.
const TIME_BUCKETS = [
  { idx: 0, lo: 0, hi: 15, label: "0-15s" },
  { idx: 1, lo: 15, hi: 30, label: "15-30s" },
  { idx: 2, lo: 30, hi: 60, label: "30-60s" },
  { idx: 3, lo: 60, hi: 120, label: "60-120s" },
  { idx: 4, lo: 120, hi: 180, label: "120-180s" },
  { idx: 5, lo: 180, hi: 240, label: "180-240s" },
  { idx: 6, lo: 240, hi: 300, label: "240-300s" },
];

// ────────────────────────────────────────────────────────────────────────────
// DB
// ────────────────────────────────────────────────────────────────────────────

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function loadFeeConfig(key, fallback) {
  const r = await client.query(
    "SELECT rate FROM fee_config WHERE fee_type = $1 LIMIT 1",
    [key],
  );
  if (r.rows.length === 0) return fallback;
  return parseFloat(r.rows[0].rate);
}

// ────────────────────────────────────────────────────────────────────────────
// Bucketization helpers
// ────────────────────────────────────────────────────────────────────────────

function bucketDist(distPct) {
  for (const b of DIST_BUCKETS) {
    if (b.idx === 0 && distPct <= b.hi) return b.idx;
    if (b.idx === DIST_BUCKETS.length - 1 && distPct >= b.lo) return b.idx;
    if (distPct > b.lo && distPct <= b.hi) return b.idx;
  }
  return DIST_BUCKETS.length - 1;
}

function bucketTime(secsLeft) {
  for (const b of TIME_BUCKETS) {
    if (secsLeft <= b.hi) return b.idx;
  }
  return TIME_BUCKETS.length - 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Isotonic regression (pool-adjacent-violators algorithm)
// Forces a sequence to be monotonically non-decreasing.
// Used per-time-bucket to enforce: p_over[dist_i+1] >= p_over[dist_i]
// ────────────────────────────────────────────────────────────────────────────

function isotonicRegression(values, weights) {
  // Pool Adjacent Violators (PAV) — produces best L2 monotone fit
  const n = values.length;
  const result = values.slice();
  const w = weights.slice();
  const blocks = [];
  for (let i = 0; i < n; i++) blocks.push({ start: i, end: i, sum: result[i] * w[i], wsum: w[i], mean: result[i] });

  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].mean <= blocks[i + 1].mean) {
      i++;
      continue;
    }
    // Pool blocks i and i+1
    const merged = {
      start: blocks[i].start,
      end: blocks[i + 1].end,
      sum: blocks[i].sum + blocks[i + 1].sum,
      wsum: blocks[i].wsum + blocks[i + 1].wsum,
    };
    merged.mean = merged.sum / merged.wsum;
    blocks.splice(i, 2, merged);
    if (i > 0) i--; // Back up to re-check left neighbor
  }

  // Expand blocks back to flat array
  for (const b of blocks) {
    for (let j = b.start; j <= b.end; j++) result[j] = b.mean;
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Jeffreys binomial CI (Beta distribution credible interval)
// Returns [lower, upper] for 95% CI
// ────────────────────────────────────────────────────────────────────────────

function jeffreysCI(wins, n, alpha = 0.05) {
  if (n === 0) return [0, 1];
  // Jeffreys uses Beta(wins+0.5, losses+0.5)
  // We approximate with Wilson-like form for simplicity
  const k = wins + 0.5;
  const m = n - wins + 0.5;
  // Mean of Beta(k, m) = k / (k+m)
  // Approx 95% CI via normal approximation for large k+m
  const total = k + m;
  const mean = k / total;
  const variance = (k * m) / (total * total * (total + 1));
  const sd = Math.sqrt(variance);
  const z = 1.96; // 95% CI
  const lo = Math.max(0, mean - z * sd);
  const hi = Math.min(1, mean + z * sd);
  return [lo, hi];
}

// ────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`recalibrate-pricing-matrix: asset=${ASSET}, duration=${DURATION}, window=${WINDOW_DAYS}d, dry-run=${DRY_RUN}`);
  await client.connect();

  // 1. Pull resolved markets from rolling window with aggregated tick counts
  console.log("\n[1/7] Pulling resolved markets and ticks...");
  console.time("pull");

  const cellsRaw = await client.query(`
    WITH window_markets AS (
      SELECT id, opens_at, closes_at, strike_price::float AS strike, outcome
      FROM speed_markets
      WHERE asset = $1
        AND duration = $2
        AND status = 'resolved'
        AND outcome IN ('over', 'under')
        AND closes_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
    ),
    tick_features AS (
      SELECT
        m.id AS market_id,
        m.outcome,
        EXTRACT(EPOCH FROM (m.closes_at - t.ts))::int AS secs_left,
        (t.price::float - m.strike) / m.strike AS dist_pct
      FROM window_markets m
      JOIN speed_oracle_ticks t
        ON t.asset = $1
        AND t.ts >= m.opens_at
        AND t.ts < m.closes_at
      -- Sample 1 tick/second to dedupe sub-second ticks
      WHERE t.ts = date_trunc('second', t.ts)
    )
    SELECT
      CASE
        WHEN dist_pct <= -0.005 THEN 0
        WHEN dist_pct <= -0.003 THEN 1
        WHEN dist_pct <= -0.002 THEN 2
        WHEN dist_pct <= -0.001 THEN 3
        WHEN dist_pct <= -0.0005 THEN 4
        WHEN dist_pct < 0 THEN 5
        WHEN dist_pct < 0.0005 THEN 6
        WHEN dist_pct < 0.001 THEN 7
        WHEN dist_pct < 0.002 THEN 8
        WHEN dist_pct < 0.003 THEN 9
        WHEN dist_pct < 0.005 THEN 10
        ELSE 11
      END AS d_idx,
      CASE
        WHEN secs_left <= 15 THEN 0
        WHEN secs_left <= 30 THEN 1
        WHEN secs_left <= 60 THEN 2
        WHEN secs_left <= 120 THEN 3
        WHEN secs_left <= 180 THEN 4
        WHEN secs_left <= 240 THEN 5
        ELSE 6
      END AS t_idx,
      COUNT(*)::int AS n_obs,
      COUNT(DISTINCT market_id)::int AS n_eff,
      SUM(CASE WHEN outcome = 'over' THEN 1 ELSE 0 END)::int AS over_count
    FROM tick_features
    GROUP BY d_idx, t_idx
    ORDER BY t_idx, d_idx
  `, [ASSET, DURATION]);

  const totalMarkets = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM speed_markets
    WHERE asset = $1
      AND duration = $2
      AND status = 'resolved'
      AND outcome IN ('over', 'under')
      AND closes_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
  `, [ASSET, DURATION]);

  console.timeEnd("pull");
  console.log(`Markets in window: ${totalMarkets.rows[0].n}, cells with data: ${cellsRaw.rows.length}`);

  if (totalMarkets.rows[0].n < 200) {
    console.error(`ABORT: insufficient markets (${totalMarkets.rows[0].n}) for ${DURATION} matrix. Need ≥200. Falling back to BSM-only is correct here.`);
    if (!DRY_RUN) {
      await client.end();
      process.exit(2);
    }
  }

  // 2. Load fee_config knobs
  console.log("\n[2/7] Loading fee_config knobs...");
  const PRIOR_N = await loadFeeConfig("speed_pricing_matrix_prior_n", 50);
  const PRIOR_P = 0.5; // neutral prior
  const MIN_N_EFF = await loadFeeConfig("speed_pricing_matrix_min_n_eff", 100);
  const CI_MAX_WIDTH = await loadFeeConfig("speed_pricing_matrix_ci_max_width", 0.12);
  console.log(`prior_n=${PRIOR_N}, prior_p=${PRIOR_P}, min_n_eff=${MIN_N_EFF}, ci_max_width=${CI_MAX_WIDTH}`);

  // 3. Build cell map with shrinkage + CI
  console.log("\n[3/7] Computing shrunk probabilities + CI per cell...");
  const cellMap = new Map(); // key: "d_t" -> cell data
  for (const r of cellsRaw.rows) {
    const key = `${r.d_idx}_${r.t_idx}`;
    const p_raw = r.over_count / r.n_obs;
    const n_eff = r.n_eff;
    // Shrinkage uses n_eff (per codex: per-market, not per-tick)
    const p_shrunk = (n_eff * p_raw + PRIOR_N * PRIOR_P) / (n_eff + PRIOR_N);
    const [ci_lo, ci_hi] = jeffreysCI(r.over_count, r.n_obs);
    const ci_width = ci_hi - ci_lo;
    cellMap.set(key, {
      d_idx: r.d_idx,
      t_idx: r.t_idx,
      n_obs: r.n_obs,
      n_eff,
      p_raw,
      p_shrunk,
      ci_lo,
      ci_hi,
      ci_width,
      qualifies: n_eff >= MIN_N_EFF && ci_width <= CI_MAX_WIDTH,
    });
  }

  // 4. Apply isotonic regression per time bucket (monotone in distance)
  console.log("\n[4/7] Enforcing monotonicity (isotonic regression per time bucket)...");
  for (const tb of TIME_BUCKETS) {
    const cellsInBucket = [];
    for (const db of DIST_BUCKETS) {
      const cell = cellMap.get(`${db.idx}_${tb.idx}`);
      if (cell) cellsInBucket.push(cell);
    }
    if (cellsInBucket.length < 2) continue;

    cellsInBucket.sort((a, b) => a.d_idx - b.d_idx);
    const values = cellsInBucket.map((c) => c.p_shrunk);
    const weights = cellsInBucket.map((c) => Math.max(1, c.n_eff)); // weight by independent samples
    const isotonic = isotonicRegression(values, weights);

    for (let i = 0; i < cellsInBucket.length; i++) {
      cellsInBucket[i].p_isotonic = isotonic[i];
    }

    if (VERBOSE) {
      console.log(`  t_bucket ${tb.label}: ${cellsInBucket.map((c) => `${c.p_shrunk.toFixed(3)}→${c.p_isotonic.toFixed(3)}`).join(", ")}`);
    }
  }

  // 5. Property tests
  console.log("\n[5/7] Running property tests...");
  const failures = [];

  // Test 1: Monotonicity in distance (post-isotonic)
  for (const tb of TIME_BUCKETS) {
    let prevP = -1;
    for (const db of DIST_BUCKETS) {
      const cell = cellMap.get(`${db.idx}_${tb.idx}`);
      if (!cell) continue;
      if (cell.p_isotonic < prevP - 1e-9) {
        failures.push(`MONOTONE FAIL: t=${tb.label}, d=${db.label}, p=${cell.p_isotonic.toFixed(4)} < prev ${prevP.toFixed(4)}`);
      }
      prevP = cell.p_isotonic;
    }
  }

  // Test 2: Values in [0, 1]
  for (const cell of cellMap.values()) {
    if (cell.p_isotonic < 0 || cell.p_isotonic > 1 || isNaN(cell.p_isotonic)) {
      failures.push(`VALUE FAIL: d=${cell.d_idx}, t=${cell.t_idx}, p=${cell.p_isotonic}`);
    }
  }

  // Test 3: At least one cell qualifies (otherwise the matrix is useless)
  const qualifyingCount = [...cellMap.values()].filter((c) => c.qualifies).length;
  if (qualifyingCount === 0) {
    failures.push(`COVERAGE FAIL: zero qualifying cells (need n_eff >= ${MIN_N_EFF} and ci_width <= ${CI_MAX_WIDTH})`);
  }

  if (failures.length > 0) {
    console.error(`PROPERTY TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    if (!FORCE) {
      console.error("\nAborting. Use --force to write anyway (NOT RECOMMENDED).");
      await client.end();
      process.exit(3);
    } else {
      console.warn("FORCE flag set, writing despite failures");
    }
  } else {
    console.log(`All property tests passed. ${qualifyingCount} qualifying cells out of ${cellMap.size}.`);
  }

  // 6. Print summary table
  console.log("\n[6/7] Matrix summary:");
  console.log("DIST\\TIME       " + TIME_BUCKETS.map((t) => t.label.padStart(10)).join(" "));
  for (const db of DIST_BUCKETS) {
    const row = [db.label.padEnd(16)];
    for (const tb of TIME_BUCKETS) {
      const cell = cellMap.get(`${db.idx}_${tb.idx}`);
      if (!cell) {
        row.push("       -- ");
      } else if (!cell.qualifies) {
        row.push((cell.p_isotonic * 100).toFixed(1).padStart(7) + "%↓");
      } else {
        row.push((cell.p_isotonic * 100).toFixed(1).padStart(8) + "%");
      }
    }
    console.log(row.join(" "));
  }
  console.log("(↓ = below n_eff or ci_width threshold; pricing falls back to BSM)");

  // 7. Write to DB
  if (DRY_RUN) {
    console.log("\n[7/7] DRY RUN — skipping DB write.");
    await client.end();
    process.exit(0);
  }

  console.log("\n[7/7] Writing version + cells to DB...");
  await client.query("BEGIN");
  try {
    const versionRes = await client.query(
      `INSERT INTO speed_pricing_matrix_versions (asset, duration, n_markets, n_obs_total, status, computed_at, notes)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       RETURNING id`,
      [
        ASSET,
        DURATION,
        totalMarkets.rows[0].n,
        cellsRaw.rows.reduce((s, r) => s + r.n_obs, 0),
        failures.length === 0 ? "active" : "rejected",
        `Auto-recalibration; window=${WINDOW_DAYS}d; failures=${failures.length}`,
      ],
    );
    const versionId = versionRes.rows[0].id;

    for (const cell of cellMap.values()) {
      await client.query(
        `INSERT INTO speed_pricing_matrix
         (version_id, asset, duration, dist_bucket, time_bucket, n_obs, n_eff, p_over_raw, p_over_shrunk, p_over_final, ci_lo, ci_hi, ci_width, qualifies)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          versionId, ASSET, DURATION,
          cell.d_idx, cell.t_idx,
          cell.n_obs, cell.n_eff,
          cell.p_raw, cell.p_shrunk, cell.p_isotonic,
          cell.ci_lo, cell.ci_hi, cell.ci_width,
          cell.qualifies,
        ],
      );
    }

    // If active, update fee_config to point at this version
    if (failures.length === 0) {
      await client.query(
        `INSERT INTO fee_config (fee_type, rate, description, updated_at)
         VALUES ('speed_pricing_matrix_version', $1, 'Active pricing matrix version (auto-set by recalibration)', NOW())
         ON CONFLICT (fee_type) DO UPDATE SET rate = $1, updated_at = NOW()`,
        [versionId],
      );

      // Mark prior versions for this (asset, duration) as superseded
      await client.query(
        `UPDATE speed_pricing_matrix_versions
         SET status = 'superseded'
         WHERE asset = $1 AND duration = $2 AND status = 'active' AND id != $3`,
        [ASSET, DURATION, versionId],
      );
    }

    await client.query("COMMIT");
    console.log(`Wrote version ${versionId} with ${cellMap.size} cells, status=${failures.length === 0 ? "active" : "rejected"}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DB write failed, rolled back:", err);
    await client.end();
    process.exit(4);
  }

  await client.end();
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try { await client.end(); } catch {}
  process.exit(1);
});
