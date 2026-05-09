// /admin/sharks — CLV throttle monitoring (Phase 5D / Sprint 2 mig 0044)
//
// Shows users currently being shaded by the per-user CLV throttle.
// Per CLAUDE.md, CLV is the surgical anti-shark layer: users with
// reliably positive edge get their offered_prob shaded UP at trade-open
// (capped at +8pp). Casuals untouched.
//
// This page is read-only for v1. Manual override (pin shading factor /
// exempt user) is admin RPC work; placeholder UI shipped, wiring in
// follow-up.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/admin-views";

// Drizzle's db.execute<T> wants T extends Record<string, unknown>; the index
// signature satisfies that without affecting runtime.
type SharkRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  settled_trades: number;
  wins: number;
  losses: number;
  avg_offered: number;
  win_rate: number;
  edge_score: number;
  edge_se: number;
  ci_low: number;
  ci_high: number;
  manual_shading_factor: number | null;
  manual_override_until: string | null;
  manual_override_reason: string | null;
  last_recomputed_at: string;
  shading_active: boolean;
  shading_pp: number;
  [key: string]: unknown;
};

interface ConfigRow {
  enabled: boolean;
  min_settled: number;
  min_ci_low: number;
  max_pp: number;
  factor: number;
  max_age_h: number;
}

async function loadConfig(): Promise<ConfigRow> {
  const r = await db.execute<{ fee_type: string; rate: string }>(sql`
    SELECT fee_type, rate::text FROM fee_config
    WHERE fee_type IN (
      'speed_clv_throttle_enabled',
      'speed_clv_min_settled_trades',
      'speed_clv_min_ci_low',
      'speed_clv_max_shading_pp',
      'speed_clv_shading_factor',
      'speed_clv_health_max_age_h'
    )
  `);
  const map: Record<string, number> = {};
  for (const row of r.rows) {
    map[row.fee_type] = Number(row.rate);
  }
  return {
    enabled: (map["speed_clv_throttle_enabled"] ?? 0) > 0,
    min_settled: map["speed_clv_min_settled_trades"] ?? 30,
    min_ci_low: map["speed_clv_min_ci_low"] ?? 0.02,
    max_pp: map["speed_clv_max_shading_pp"] ?? 0.08,
    factor: map["speed_clv_shading_factor"] ?? 0.7,
    max_age_h: map["speed_clv_health_max_age_h"] ?? 36,
  };
}

async function loadSharks(): Promise<SharkRow[]> {
  // Wide query: all users with computed edge scores, top 50 by edge_score desc.
  const r = await db.execute<SharkRow>(sql`
    SELECT
      e.user_id,
      u.email,
      u.display_name,
      e.settled_trades,
      e.wins,
      e.losses,
      e.avg_offered::float AS avg_offered,
      e.win_rate::float AS win_rate,
      e.edge_score::float AS edge_score,
      e.edge_se::float AS edge_se,
      e.ci_low::float AS ci_low,
      e.ci_high::float AS ci_high,
      e.manual_shading_factor::float AS manual_shading_factor,
      e.manual_override_until,
      e.manual_override_reason,
      e.last_recomputed_at,
      FALSE AS shading_active,
      0::float AS shading_pp
    FROM speed_user_edge_scores e
    JOIN users u ON u.id = e.user_id
    ORDER BY e.edge_score DESC
    LIMIT 50
  `);
  return r.rows;
}

function computeShadingState(
  row: SharkRow,
  cfg: ConfigRow,
): { active: boolean; pp: number; reason?: string } {
  if (!cfg.enabled) return { active: false, pp: 0, reason: "throttle disabled" };

  // Manual override
  if (row.manual_override_until) {
    const until = new Date(row.manual_override_until);
    if (until.getTime() > Date.now()) {
      if (row.manual_shading_factor === null) {
        return { active: false, pp: 0, reason: "admin exempt" };
      }
      return {
        active: true,
        pp: Math.min(0.20, row.manual_shading_factor),
        reason: "admin override",
      };
    }
  }

  // Stale check
  const ageH =
    (Date.now() - new Date(row.last_recomputed_at).getTime()) / 3_600_000;
  if (ageH > cfg.max_age_h) {
    return { active: false, pp: 0, reason: `cron stale (${ageH.toFixed(1)}h)` };
  }

  if (row.settled_trades < cfg.min_settled) {
    return {
      active: false,
      pp: 0,
      reason: `< ${cfg.min_settled} settled (${row.settled_trades})`,
    };
  }

  if (row.ci_low <= cfg.min_ci_low) {
    return {
      active: false,
      pp: 0,
      reason: `ci_low ${(row.ci_low * 100).toFixed(2)}% ≤ ${(cfg.min_ci_low * 100).toFixed(2)}% gate`,
    };
  }

  const computed = Math.min(cfg.max_pp, row.edge_score * cfg.factor);
  if (computed <= 0) return { active: false, pp: 0, reason: "computed = 0" };
  return { active: true, pp: computed };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function pp(v: number): string {
  return `+${(v * 100).toFixed(2)}pp`;
}

export default async function AdminSharksPage() {
  // Phase 5D / P1 mitigation: superadmin-only at the page level so a
  // restricted admin who knows the URL can't reach the per-user edge
  // scores. Sidebar also hides the link via isSuperAdmin gate.
  const { allowedViews } = await requireAdmin();
  if (!isSuperAdmin(allowedViews)) {
    redirect("/admin");
  }

  const [cfg, rows] = await Promise.all([loadConfig(), loadSharks()]);

  // Compute shading state per row
  const enriched = rows.map((r) => ({ row: r, state: computeShadingState(r, cfg) }));
  const activelyShaded = enriched.filter((e) => e.state.active);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Sharks (CLV throttle)
        </h2>
        <p className="text-[#566166] mt-2">
          Per-user closing-line-value throttle. Sharks get their offered
          probabilities shaded UP at trade-open, reducing their per-win
          payout. Casuals untouched. Recomputed nightly at 04:00 UTC.
        </p>
      </div>

      {/* Status banner */}
      <div
        className={`rounded-xl border p-4 ${
          cfg.enabled
            ? "border-emerald-300 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <p className="text-sm font-semibold">
          {cfg.enabled ? (
            <>
              <span className="text-emerald-800">● CLV throttle ACTIVE</span> —
              {activelyShaded.length} user{activelyShaded.length === 1 ? "" : "s"} currently being shaded
            </>
          ) : (
            <span className="text-amber-800">
              ○ CLV throttle DISABLED — no shading is applied. Flip
              speed_clv_throttle_enabled = 1 to activate.
            </span>
          )}
        </p>
        <p className="text-xs text-[#566166] mt-2">
          Gate: <strong>{cfg.min_settled}+</strong> settled trades AND ci_low &gt;{" "}
          <strong>{pct(cfg.min_ci_low)}</strong>. Cap:{" "}
          <strong>{pp(cfg.max_pp)}</strong> max shading. Computed shading ={" "}
          <strong>{(cfg.factor * 100).toFixed(0)}%</strong> of measured edge.
        </p>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="grid grid-cols-[2fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_1fr] gap-3 border-b border-[#e8eff3] bg-[#f0f4f7] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#566166]">
          <span>User</span>
          <span className="text-right">Settled</span>
          <span className="text-right">Win %</span>
          <span className="text-right">Avg offer</span>
          <span className="text-right">Edge</span>
          <span className="text-right">CI low</span>
          <span className="text-right">Shade</span>
          <span>Status</span>
        </div>
        {enriched.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-[#566166]">
            No edge scores computed yet. Cron runs nightly at 04:00 UTC.
            <br />
            Manual run: <code className="text-xs">SELECT _speed_recompute_edge_scores();</code>
          </div>
        )}
        {enriched.map(({ row, state }) => (
          <div
            key={row.user_id}
            className={`grid grid-cols-[2fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_0.7fr_1fr] gap-3 border-b border-[#e8eff3] px-5 py-3.5 text-sm tabular-nums ${
              state.active ? "bg-amber-50/50" : ""
            }`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-[#2a3439] truncate">
                {row.email ?? row.display_name ?? row.user_id.slice(0, 8)}
              </div>
              <div className="text-xs text-[#566166] truncate">
                {row.user_id.slice(0, 8)}
              </div>
            </div>
            <div className="text-right">{row.settled_trades}</div>
            <div className="text-right">{pct(row.win_rate)}</div>
            <div className="text-right">{pct(row.avg_offered)}</div>
            <div
              className={`text-right font-semibold ${
                row.edge_score > 0.05
                  ? "text-amber-700"
                  : row.edge_score < -0.05
                    ? "text-emerald-700"
                    : ""
              }`}
            >
              {row.edge_score > 0 ? "+" : ""}
              {pct(row.edge_score)}
            </div>
            <div className="text-right text-xs">
              {row.ci_low > 0 ? "+" : ""}
              {pct(row.ci_low)}
            </div>
            <div className="text-right">
              {state.active ? (
                <span className="font-bold text-amber-800">{pp(state.pp)}</span>
              ) : (
                <span className="text-[#a9b4b9]">—</span>
              )}
            </div>
            <div className="text-xs">
              {state.active ? (
                <span className="font-medium text-amber-800">SHADED</span>
              ) : (
                <span className="text-[#566166]">{state.reason}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs text-[#566166] space-y-1">
        <p>
          <strong>Legend:</strong> Edge = win_rate − avg_offered. Positive edge
          = user wins more often than priced. CI low = lower bound of one-tailed
          95% Jeffreys interval. Shading fires only when CI low &gt; gate
          AND settled ≥ floor.
        </p>
        <p className="text-[#717c82]">
          Manual override + exempt workflows are documented in{" "}
          <code>docs/CONFIG_HIDDEN.md</code> → &quot;Sharks override&quot;
          section. A proper override RPC + audit trail will land in a follow-up
          sprint.
        </p>
      </div>
    </div>
  );
}
