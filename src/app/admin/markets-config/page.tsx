// /admin/markets-config — Phase 5E
//
// Per-(asset, duration) config editor. Reads from speed_market_config
// (the canonical post-mig 0049-0051 source for migrated values) and
// writes via PATCH /api/admin/markets-config/[asset]/[duration].
//
// CHECK constraints from mig 0042 + the Zod schema in the PATCH route
// are the two server-side validation layers. The form here is just a
// thin client-side echo — it doesn't gate values, it just prevents the
// most obvious typos from round-tripping to the DB.
//
// Superadmin-only (per Phase 5G plan note: this is the highest blast
// radius surface in admin land).

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/admin-views";
import { MarketsConfigEditor } from "@/components/admin/markets-config-editor";

type MarketConfigRow = {
  asset: string;
  duration: string;
  stake_min_usd: number;
  stake_max_usd: number;
  payout_max_usd: number;
  cap_per_side_usd: number;
  per_side_pool_pct: number;
  per_user_open_exposure_pct: number;
  velocity_max_per_min: number;
  daily_handle_alert_usd: number;
  spread_pct: number;
  soft_block_threshold: number;
  soft_block_unlock: number;
  late_window_60s_secs: number;
  late_window_30s_secs: number;
  late_window_60s_mult: number;
  late_window_30s_mult: number;
  last_n_reject_secs: number;
  near_decided_dist: number;
  cashout_winning_base: number;
  cashout_losing_base: number;
  cashout_saturation_coef: number;
  cashout_desperation_coef: number;
  cashout_late_winning_coef: number;
  cashout_late_losing_coef: number;
  cashout_reject_secs: number;
  cashout_late_30s_imbalance: number;
  cashout_cap_edge_threshold: number;
  matrix_min_n_eff: number;
  matrix_ci_max_width: number;
  matrix_prior_n: number;
  matrix_calibration_window_days: number;
  enabled: boolean;
  notes: string | null;
  updated_at: string;
  [key: string]: unknown;
};

type AssetConfigRow = {
  asset: string;
  oracle_source: string;
  oracle_stale_seconds: number | null;
  wick_threshold_pct: number;
  display_decimals: number;
  enabled: boolean;
  trading_hours_json: unknown;
  notes: string | null;
  [key: string]: unknown;
};

async function loadMarketConfigs(): Promise<MarketConfigRow[]> {
  const r = await db.execute<MarketConfigRow>(sql`
    SELECT
      asset,
      duration::text AS duration,
      stake_min_usd::float AS stake_min_usd,
      stake_max_usd::float AS stake_max_usd,
      payout_max_usd::float AS payout_max_usd,
      cap_per_side_usd::float AS cap_per_side_usd,
      per_side_pool_pct::float AS per_side_pool_pct,
      per_user_open_exposure_pct::float AS per_user_open_exposure_pct,
      velocity_max_per_min,
      daily_handle_alert_usd::float AS daily_handle_alert_usd,
      spread_pct::float AS spread_pct,
      soft_block_threshold::float AS soft_block_threshold,
      soft_block_unlock::float AS soft_block_unlock,
      late_window_60s_secs,
      late_window_30s_secs,
      late_window_60s_mult::float AS late_window_60s_mult,
      late_window_30s_mult::float AS late_window_30s_mult,
      last_n_reject_secs,
      near_decided_dist::float AS near_decided_dist,
      cashout_winning_base::float AS cashout_winning_base,
      cashout_losing_base::float AS cashout_losing_base,
      cashout_saturation_coef::float AS cashout_saturation_coef,
      cashout_desperation_coef::float AS cashout_desperation_coef,
      cashout_late_winning_coef::float AS cashout_late_winning_coef,
      cashout_late_losing_coef::float AS cashout_late_losing_coef,
      cashout_reject_secs,
      cashout_late_30s_imbalance::float AS cashout_late_30s_imbalance,
      cashout_cap_edge_threshold::float AS cashout_cap_edge_threshold,
      matrix_min_n_eff,
      matrix_ci_max_width::float AS matrix_ci_max_width,
      matrix_prior_n,
      matrix_calibration_window_days,
      enabled,
      notes,
      updated_at::text AS updated_at
    FROM speed_market_config
    ORDER BY asset, duration
  `);
  return r.rows;
}

/**
 * Global feature flags that gate visibility on top of per-row enabled.
 * A market is live to users only if ALL of these are true:
 *   1. speed_market_config.enabled (per-row, edited inside the editor)
 *   2. speed_assets.{asset}.enabled (per-asset gate, in the asset card)
 *   3. global feature flag in fee_config (this map)
 *
 * BTC has no global gate (always live since launch). 1m and gold each have
 * their own. The editor uses this to show an "effective state" badge per
 * tab so admins don't get confused by enabled=true rows that users can't
 * actually see.
 */
type GlobalFlags = {
  speed_markets_enabled: boolean;
  speed_1m_markets_enabled: boolean;
  speed_gold_markets_enabled: boolean;
};

async function loadGlobalFlags(): Promise<GlobalFlags> {
  const r = await db.execute<{ fee_type: string; rate: string }>(sql`
    SELECT fee_type, rate::text FROM fee_config
    WHERE fee_type IN (
      'speed_markets_enabled',
      'speed_1m_markets_enabled',
      'speed_gold_markets_enabled'
    )
  `);
  const map: Record<string, number> = {};
  for (const row of r.rows) map[row.fee_type] = Number(row.rate);
  return {
    speed_markets_enabled: (map["speed_markets_enabled"] ?? 0) > 0,
    speed_1m_markets_enabled: (map["speed_1m_markets_enabled"] ?? 0) > 0,
    speed_gold_markets_enabled: (map["speed_gold_markets_enabled"] ?? 0) > 0,
  };
}

async function loadAssetConfigs(): Promise<AssetConfigRow[]> {
  // oracle_stale_seconds was added in mig 0052. Use to_jsonb to tolerate
  // schema variants — if the column doesn't exist (older staging), the
  // SELECT below will throw and we'll fall back to a no-stale query.
  try {
    const r = await db.execute<AssetConfigRow>(sql`
      SELECT
        asset,
        oracle_source,
        oracle_stale_seconds,
        wick_threshold_pct::float AS wick_threshold_pct,
        display_decimals,
        enabled,
        trading_hours_json,
        notes
      FROM speed_asset_config
      ORDER BY asset
    `);
    return r.rows;
  } catch {
    const r = await db.execute<AssetConfigRow>(sql`
      SELECT
        asset,
        oracle_source,
        NULL::int AS oracle_stale_seconds,
        wick_threshold_pct::float AS wick_threshold_pct,
        display_decimals,
        enabled,
        trading_hours_json,
        notes
      FROM speed_asset_config
      ORDER BY asset
    `);
    return r.rows;
  }
}

export default async function AdminMarketsConfigPage() {
  // Superadmin-only — same gate as /admin/sharks. Per-market knobs are the
  // single highest-blast-radius surface in admin land; one bad save can
  // misprice every trade.
  const { allowedViews } = await requireAdmin();
  if (!isSuperAdmin(allowedViews)) {
    redirect("/admin");
  }

  const [markets, assets, flags] = await Promise.all([
    loadMarketConfigs(),
    loadAssetConfigs(),
    loadGlobalFlags(),
  ]);

  // Map asset -> enabled boolean for quick lookup in the editor
  const assetEnabled: Record<string, boolean> = {};
  for (const a of assets) assetEnabled[a.asset] = a.enabled;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Markets Config
        </h2>
        <p className="text-[#566166] mt-2 max-w-3xl">
          Per-(asset, duration) pricing knobs. Trade + cashout RPCs read
          from <code className="text-xs">speed_market_config</code> first,
          then fall back to fee_config (legacy) and hardcoded defaults.
          Edits here take effect on the next quote — no redeploy.
        </p>
        <p className="text-amber-700 text-xs mt-3">
          ⚠ All values are CHECK-constrained at the DB layer. A bad save
          will be rejected with a 400; existing config is unchanged. Audit
          row written to <code>admin_action_log</code> on every successful
          save.
        </p>
      </div>

      {/* Asset summary */}
      <section>
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#566166] mb-3">
          Assets
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assets.map((a) => (
            <div
              key={a.asset}
              className={`rounded-xl border p-4 ${
                a.enabled
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-amber-300 bg-amber-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#2a3439]">{a.asset}</span>
                <span
                  className={`text-xs font-semibold ${
                    a.enabled ? "text-emerald-800" : "text-amber-800"
                  }`}
                >
                  {a.enabled ? "● ENABLED" : "○ DISABLED"}
                </span>
              </div>
              <div className="mt-2 text-xs text-[#566166] space-y-1">
                <div>
                  Oracle: <code>{a.oracle_source}</code>
                </div>
                <div>
                  Stale-secs:{" "}
                  <strong>{a.oracle_stale_seconds ?? "(global default)"}</strong>{" "}
                  · Wick: <strong>{(a.wick_threshold_pct * 100).toFixed(2)}%</strong>{" "}
                  · Decimals: <strong>{a.display_decimals}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Global flag banner — explains why some markets are dark even if row=enabled */}
      <section>
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#566166] mb-3">
          Global feature flags
        </h3>
        <div className="rounded-xl bg-white p-4 text-xs space-y-2">
          <p className="text-[#566166]">
            A market is live to users only when{" "}
            <strong>all three layers</strong> are ON:{" "}
            <strong>per-row enabled</strong> (edit below) AND{" "}
            <strong>asset enabled</strong> (above) AND{" "}
            <strong>global flag</strong> (here).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            <FlagPill
              label="Speed markets"
              on={flags.speed_markets_enabled}
              hint="Master kill switch for the entire speed product"
            />
            <FlagPill
              label="1m markets"
              on={flags.speed_1m_markets_enabled}
              hint="Gates BTC-1m and GOLD-1m markets"
            />
            <FlagPill
              label="Gold markets"
              on={flags.speed_gold_markets_enabled}
              hint="Gates GOLD-5m and GOLD-1m markets"
            />
          </div>
        </div>
      </section>

      {/* Market config editor */}
      <section>
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-[#566166] mb-3">
          Market knobs (per asset × duration)
        </h3>
        <MarketsConfigEditor
          markets={markets}
          assetEnabled={assetEnabled}
          flags={flags}
        />
      </section>
    </div>
  );
}

function FlagPill({
  label,
  on,
  hint,
}: {
  label: string;
  on: boolean;
  hint: string;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        on ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-[#2a3439]">{label}</span>
        <span
          className={`text-[10px] font-semibold ${
            on ? "text-emerald-800" : "text-amber-800"
          }`}
        >
          {on ? "● ON" : "○ OFF"}
        </span>
      </div>
      <p className="text-[10px] text-[#566166] mt-1">{hint}</p>
    </div>
  );
}
