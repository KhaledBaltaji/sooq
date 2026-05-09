#!/usr/bin/env node
/**
 * scripts/dump-hidden-config.mjs
 *
 * Read current values for every "hidden" config knob and rewrite the
 * relevant sections of docs/CONFIG_HIDDEN.md in place.
 *
 * Sections updated (only between the matching <!-- BEGIN/END --> markers):
 *   - fees-pricing-internals
 *   - fees-matrix-internals
 *   - fees-iv-internals
 *   - fees-cashout-deprecated
 *   - fees-stake-deprecated
 *   - markets-config-values
 *
 * Usage: node scripts/dump-hidden-config.mjs
 *
 * Reads DATABASE_URL from .env.local. Read-only against the DB; only
 * writes to the local markdown file.
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

// Load .env.local first (matches local-dev pattern), fall back to .env
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local") });
loadEnv();

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(__dirname, "..", "docs", "CONFIG_HIDDEN.md");

const FEE_GROUPS = {
  "fees-pricing-internals": [
    ["speed_extreme_spread_coeff", "Quadratic widening past ±0.45 from 0.5"],
    ["speed_late_60s_spread_mult", "Multiplier on base spread in last 60s (per-market overrides)"],
    ["speed_late_30s_spread_mult", "Multiplier on base spread in last 30s (per-market overrides)"],
    ["speed_fair_prob_reject_high", "Hard reject above (default 0.97)"],
    ["speed_fair_prob_reject_low", "Hard reject below (default 0.03)"],
    ["speed_late_30s_imbalance_reject", "Last-30s |fair − 0.5| reject threshold"],
    ["speed_cashout_late_30s_imbalance_reject", "Mirror for cashouts"],
    ["speed_cashout_late_reject_s", "Hard-reject cashouts in last N seconds"],
    ["speed_spread_pct", "Base 5% spread (per-market overrides)"],
  ],
  "fees-matrix-internals": [
    ["speed_pricing_matrix_version", "Active matrix version (auto-set by cron)"],
    ["speed_pricing_matrix_min_n_eff", "Min effective N per cell"],
    ["speed_pricing_matrix_ci_max_width", "Max CI width before shrinking to BSM"],
    ["speed_pricing_matrix_prior_n", "Bayesian prior strength"],
    ["speed_entry_soft_block_threshold", "Soft-block trigger probability"],
    ["speed_entry_soft_block_unlock_threshold", "Soft-block hysteresis unlock"],
    ["speed_cashout_cap_edge_threshold", "Cashout cap-edge threshold"],
  ],
  "fees-iv-internals": [
    ["speed_iv_btc", "Fallback annualized BTC vol"],
    ["speed_iv_drift_tolerance_pct", "IV drift tolerance for stale-quote check"],
  ],
  "fees-cashout-deprecated": [
    ["speed_cashout_winning_base_5m", "Fallback only — per-market wins"],
    ["speed_cashout_winning_base_1h", "Fallback only"],
    ["speed_cashout_losing_base_5m", "Fallback only"],
    ["speed_cashout_losing_base_1h", "Fallback only"],
    ["speed_cashout_saturation_coef", "Fallback only"],
    ["speed_cashout_desperation_coef", "Fallback only"],
    ["speed_cashout_late_window_winning_coef", "Fallback only"],
    ["speed_cashout_late_window_losing_coef", "Fallback only"],
  ],
  "fees-stake-deprecated": [
    ["speed_stake_max_5m_usd", "Fallback only — per-market wins"],
    ["speed_stake_max_1h_usd", "Fallback only"],
    ["speed_cap_per_side_usd", "Fallback only"],
    ["speed_stake_max_usd", "Legacy single-cap, fallback only"],
  ],
};

const ADVANCED_MARKET_COLUMNS = [
  // Risk caps
  "per_side_pool_pct",
  "per_user_open_exposure_pct",
  "velocity_max_per_min",
  "daily_handle_alert_usd",
  // Pricing — entry
  "spread_pct",
  "soft_block_threshold",
  "soft_block_unlock",
  "late_window_60s_secs",
  "late_window_30s_secs",
  "late_window_60s_mult",
  "late_window_30s_mult",
  "last_n_reject_secs",
  "near_decided_dist",
  // Cashout
  "cashout_winning_base",
  "cashout_losing_base",
  "cashout_saturation_coef",
  "cashout_desperation_coef",
  "cashout_late_winning_coef",
  "cashout_late_losing_coef",
  "cashout_reject_secs",
  "cashout_late_30s_imbalance",
  "cashout_cap_edge_threshold",
  // Matrix
  "matrix_min_n_eff",
  "matrix_ci_max_width",
  "matrix_prior_n",
  "matrix_calibration_window_days",
];

function buildPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Source .env.local first.");
    process.exit(1);
  }
  // Strip sslmode like src/lib/db/index.ts does
  const cleaned = url.replace(/[?&]sslmode=[^&]+/g, "");
  return new Pool({
    connectionString: cleaned,
    ssl: { rejectUnauthorized: false },
  });
}

function fmt(rate) {
  if (rate === null || rate === undefined) return "—";
  const n = Number(rate);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function replaceSection(doc, marker, replacement) {
  const begin = `<!-- BEGIN: ${marker} -->`;
  const end = `<!-- END: ${marker} -->`;
  const re = new RegExp(
    `${begin}[\\s\\S]*?${end}`,
    "m",
  );
  if (!re.test(doc)) {
    console.warn(`  ⚠ marker "${marker}" not found in doc; skipping`);
    return doc;
  }
  return doc.replace(re, `${begin}\n${replacement}\n${end}`);
}

async function main() {
  const pool = buildPool();
  let doc = readFileSync(DOC_PATH, "utf8");

  // 1) fee_config sections
  for (const [marker, keys] of Object.entries(FEE_GROUPS)) {
    const fee_types = keys.map(([k]) => k);
    const { rows } = await pool.query(
      `SELECT fee_type, rate FROM fee_config WHERE fee_type = ANY($1::text[])`,
      [fee_types],
    );
    const rateByKey = Object.fromEntries(rows.map((r) => [r.fee_type, r.rate]));

    const isFallback = marker.endsWith("-deprecated");
    const header = isFallback
      ? "| Key | Current | Read by |"
      : "| Key | Current | What it does |";
    const sep = "|---|---|---|";
    const body = keys
      .map(([k, hint]) => `| \`${k}\` | ${fmt(rateByKey[k])} | ${hint} |`)
      .join("\n");
    doc = replaceSection(doc, marker, `${header}\n${sep}\n${body}`);
    console.log(`  ✓ ${marker} (${keys.length} keys)`);
  }

  // 2) speed_market_config rows
  const { rows: marketRows } = await pool.query(
    `SELECT asset, duration::text AS duration,
            ${ADVANCED_MARKET_COLUMNS.map((c) => `${c}::text AS ${c}`).join(", ")}
       FROM speed_market_config
      ORDER BY asset, duration`,
  );

  const marketBlocks = marketRows
    .map((row) => {
      const lines = [
        `### ${row.asset} · ${row.duration}`,
        "",
        "| Field | Current |",
        "|---|---|",
        ...ADVANCED_MARKET_COLUMNS.map((c) => `| \`${c}\` | ${row[c] ?? "—"} |`),
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  doc = replaceSection(doc, "markets-config-values", marketBlocks);
  console.log(`  ✓ markets-config-values (${marketRows.length} markets)`);

  writeFileSync(DOC_PATH, doc, "utf8");
  console.log(`\nWrote ${DOC_PATH}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
