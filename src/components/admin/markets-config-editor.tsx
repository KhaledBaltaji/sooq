"use client";

// Phase 5E — markets-config editor (client component).
//
// Renders one tab per (asset, duration) row. Each tab has a form
// grouped by category. Save button posts changed fields only to
// PATCH /api/admin/markets-config/[asset]/[duration]. Server is the
// validation source of truth — this component just collects inputs.
//
// "Changed fields only" is intentional. We never re-send unchanged
// columns; the server logs the exact diff to admin_action_log.

import { useState } from "react";

interface MarketRow {
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
}

type EditableNumericKey = Exclude<
  keyof MarketRow,
  "asset" | "duration" | "enabled" | "notes" | "updated_at"
>;

type FieldGroup = {
  title: string;
  hint?: string;
  fields: ReadonlyArray<{
    key: EditableNumericKey;
    label: string;
    hint: string;
    step?: number;
  }>;
};

const FIELD_GROUPS: ReadonlyArray<FieldGroup> = [
  {
    title: "Stake & payout bounds",
    fields: [
      { key: "stake_min_usd", label: "Stake min ($)", hint: "Smallest allowed bet.", step: 1 },
      { key: "stake_max_usd", label: "Stake max ($)", hint: "Hard ceiling per ticket. Dynamic stake formula throttles below this for capped outcomes.", step: 1 },
      { key: "payout_max_usd", label: "Payout max ($)", hint: "Max payout-if-won per ticket.", step: 1 },
      { key: "cap_per_side_usd", label: "Per-user per-side cap ($)", hint: "Max combined liability per user per market per side.", step: 1 },
    ],
  },
  {
    title: "Risk caps",
    fields: [
      { key: "per_side_pool_pct", label: "Per-side pool %", hint: "Max book imbalance vs collateral pool. 0.25 = 25%.", step: 0.01 },
      { key: "per_user_open_exposure_pct", label: "Per-user open exposure %", hint: "Max liability across all open positions per user.", step: 0.01 },
      { key: "velocity_max_per_min", label: "Velocity cap (bets/min)", hint: "Per-user rate limit. Hard reject above this.", step: 1 },
      { key: "daily_handle_alert_usd", label: "Daily handle alert ($)", hint: "Telemetry threshold. Logs to speed_user_alerts; doesn't block.", step: 100 },
    ],
  },
  {
    title: "Pricing — entry",
    fields: [
      { key: "spread_pct", label: "Spread %", hint: "Base spread baked into offered_prob. 0.05 = 5%.", step: 0.005 },
      { key: "soft_block_threshold", label: "Soft-block threshold", hint: "Reject entries when offered_prob ≥ this.", step: 0.01 },
      { key: "soft_block_unlock", label: "Soft-block unlock", hint: "Hysteresis; must be < threshold.", step: 0.01 },
      { key: "late_window_60s_secs", label: "Late 60s window (s)", hint: "Last-N seconds tier 1.", step: 1 },
      { key: "late_window_30s_secs", label: "Late 30s window (s)", hint: "Last-N seconds tier 2 (must be < tier 1).", step: 1 },
      { key: "late_window_60s_mult", label: "Late 60s spread ×", hint: "Multiplicative spread escalation in last 60s window.", step: 0.05 },
      { key: "late_window_30s_mult", label: "Late 30s spread ×", hint: "Multiplicative spread escalation in last 30s window.", step: 0.05 },
      { key: "last_n_reject_secs", label: "Last-N reject (s)", hint: "Hard-reject all entries inside this window.", step: 1 },
      { key: "near_decided_dist", label: "Near-decided dist", hint: "Last 30s reject when |fair − 0.5| > this.", step: 0.05 },
    ],
  },
  {
    title: "Cashout (margin coefficients)",
    hint: "Direction-matching invariant: if mark > entry, cashout > stake — always. Coefficients shape the margin curve.",
    fields: [
      { key: "cashout_winning_base", label: "Winning base", hint: "Floor margin on winning cashouts (CFD-style spread on close).", step: 0.005 },
      { key: "cashout_losing_base", label: "Losing base", hint: "Floor margin on losing cashouts (CFD-style slippage on stops).", step: 0.005 },
      { key: "cashout_saturation_coef", label: "Saturation coef", hint: "Premium added when winning side approaches 1.0.", step: 0.05 },
      { key: "cashout_desperation_coef", label: "Desperation coef", hint: "Premium added when losing side approaches 0.0.", step: 0.05 },
      { key: "cashout_late_winning_coef", label: "Late winning coef", hint: "Late-window premium (winning side).", step: 0.005 },
      { key: "cashout_late_losing_coef", label: "Late losing coef", hint: "Late-window premium (losing side).", step: 0.005 },
      { key: "cashout_reject_secs", label: "Cashout reject (s)", hint: "Hard-reject cashouts inside this window.", step: 1 },
      { key: "cashout_late_30s_imbalance", label: "Cashout late-30 imbalance", hint: "Mirror of entry near-decided block.", step: 0.05 },
      { key: "cashout_cap_edge_threshold", label: "Cap-edge threshold", hint: "Cashout disabled (\"hold for settlement\") when entry+mark both ≥ this.", step: 0.005 },
    ],
  },
  {
    title: "Matrix calibration",
    hint: "Bayesian-shrunk pricing matrix. Cells below floor or above CI width fall back to BSM.",
    fields: [
      { key: "matrix_min_n_eff", label: "Matrix min N_eff", hint: "Cells with effective N below this fall back to BSM.", step: 10 },
      { key: "matrix_ci_max_width", label: "Matrix CI max width", hint: "Cells with wider CI shrink hard to BSM.", step: 0.01 },
      { key: "matrix_prior_n", label: "Matrix prior N", hint: "Bayesian shrinkage weight toward BSM prior.", step: 10 },
      { key: "matrix_calibration_window_days", label: "Calibration window (days)", hint: "Rolling window for nightly recalibration.", step: 1 },
    ],
  },
];

export function MarketsConfigEditor({ markets }: { markets: MarketRow[] }) {
  const [activeKey, setActiveKey] = useState<string>(() => {
    if (markets.length === 0) return "";
    const first = markets[0]!;
    return `${first.asset}-${first.duration}`;
  });

  if (markets.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-sm text-[#566166]">
        No rows in <code>speed_market_config</code>. Apply mig 0042 +
        the Phase 2 migrations to seed BTC-5m, BTC-1m, GOLD-5m, GOLD-1m.
      </div>
    );
  }

  const active = markets.find(
    (m) => `${m.asset}-${m.duration}` === activeKey,
  );

  return (
    <div>
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b border-[#e8eff3] mb-4">
        {markets.map((m) => {
          const k = `${m.asset}-${m.duration}`;
          const isActive = k === activeKey;
          return (
            <button
              key={k}
              onClick={() => setActiveKey(k)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                isActive
                  ? "border-[var(--yes,#2D8CFF)] text-[#2a3439]"
                  : "border-transparent text-[#566166] hover:text-[#2a3439]"
              } ${m.enabled ? "" : "opacity-60"}`}
              type="button"
            >
              {m.asset} · {m.duration}
              {!m.enabled && (
                <span className="ms-2 text-[10px] uppercase tracking-wider text-amber-700">
                  off
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active && <MarketTab key={activeKey} row={active} />}
    </div>
  );
}

function MarketTab({ row }: { row: MarketRow }) {
  // Clone original so "changed fields only" diff works
  const [original] = useState<MarketRow>(row);
  const [draft, setDraft] = useState<MarketRow>(row);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const setField = (k: EditableNumericKey, v: number) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const setEnabled = (v: boolean) => {
    setDraft((d) => ({ ...d, enabled: v }));
  };

  const setNotes = (v: string) => {
    setDraft((d) => ({ ...d, notes: v }));
  };

  const buildDiff = (): Record<string, number | boolean | string> => {
    const out: Record<string, number | boolean | string> = {};
    for (const group of FIELD_GROUPS) {
      for (const f of group.fields) {
        if (draft[f.key] !== original[f.key]) {
          out[f.key] = draft[f.key];
        }
      }
    }
    if (draft.enabled !== original.enabled) out.enabled = draft.enabled;
    if ((draft.notes ?? "") !== (original.notes ?? "")) {
      out.notes = draft.notes ?? "";
    }
    return out;
  };

  const dirty = Object.keys(buildDiff()).length > 0;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const diff = buildDiff();
    if (Object.keys(diff).length === 0) {
      setSaving(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/markets-config/${draft.asset}/${draft.duration}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(diff),
        },
      );
      const json = (await res.json()) as
        | { ok: true; updated_fields: string[] }
        | { error: string; issues?: string[] };
      if (!res.ok || !("ok" in json)) {
        const issues =
          "issues" in json && json.issues ? `: ${json.issues.join("; ")}` : "";
        const err = "error" in json ? json.error : "Save failed";
        setMessage({ kind: "err", text: `${err}${issues}` });
      } else {
        setMessage({
          kind: "ok",
          text: `Saved ${json.updated_fields.length} field${json.updated_fields.length === 1 ? "" : "s"}. Refresh to confirm.`,
        });
      }
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-[#2a3439]">
            {row.asset} · {row.duration}
          </h4>
          <p className="text-xs text-[#566166] mt-1">
            Last updated{" "}
            <code>{new Date(row.updated_at).toLocaleString()}</code>
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-medium">Market enabled</span>
        </label>
      </div>

      {FIELD_GROUPS.map((group) => (
        <fieldset
          key={group.title}
          className="border border-[#e8eff3] rounded-lg p-4"
        >
          <legend className="px-2 text-xs font-bold uppercase tracking-[0.18em] text-[#566166]">
            {group.title}
          </legend>
          {group.hint && (
            <p className="text-xs text-[#566166] mb-3">{group.hint}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.fields.map((f) => {
              const value = draft[f.key];
              const orig = original[f.key];
              const changed = value !== orig;
              return (
                <label key={f.key} className="block text-xs">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-[#2a3439]">
                      {f.label}
                    </span>
                    {changed && (
                      <span className="text-[10px] text-amber-700 font-bold">
                        was {String(orig)}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step={f.step ?? "any"}
                    value={Number(value)}
                    onChange={(e) =>
                      setField(f.key, Number(e.target.value))
                    }
                    className={`mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm tabular-nums ${
                      changed
                        ? "border-amber-400 bg-amber-50"
                        : "border-[#e8eff3] bg-white"
                    }`}
                  />
                  <p className="mt-1 text-[#566166]">{f.hint}</p>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <fieldset className="border border-[#e8eff3] rounded-lg p-4">
        <legend className="px-2 text-xs font-bold uppercase tracking-[0.18em] text-[#566166]">
          Notes
        </legend>
        <textarea
          value={draft.notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Free-form admin notes (max 500 chars)"
          className="w-full rounded-md border border-[#e8eff3] bg-white px-3 py-2 text-sm"
        />
      </fieldset>

      {/* Save bar */}
      <div className="flex items-center gap-3 pt-2 border-t border-[#e8eff3]">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`px-4 py-2 rounded-md text-sm font-bold ${
            dirty && !saving
              ? "bg-[var(--yes,#2D8CFF)] text-white"
              : "bg-[#e8eff3] text-[#a9b4b9] cursor-not-allowed"
          }`}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setDraft(original);
              setMessage(null);
            }}
            className="px-4 py-2 rounded-md text-sm font-medium text-[#566166] hover:text-[#2a3439]"
          >
            Discard
          </button>
        )}
        {message && (
          <span
            className={`text-xs font-medium ${
              message.kind === "ok" ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
