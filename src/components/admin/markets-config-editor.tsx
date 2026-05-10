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
  // 0055: tie-loser settlement rule (1m only)
  tie_loser_rule_enabled: boolean;
  tie_low_stake_threshold_usd: number;
  enabled: boolean;
  notes: string | null;
  updated_at: string;
  // 0055: count of currently-open markets that opened with tie_loser_rule_active=TRUE.
  // Read-only. Server populates from speed_markets snapshot. Helps admins see
  // what's in flight after toggling the config flag.
  open_with_tie_rule_active?: number;
}

type EditableNumericKey = Exclude<
  keyof MarketRow,
  | "asset"
  | "duration"
  | "enabled"
  | "notes"
  | "updated_at"
  | "tie_loser_rule_enabled"
  | "open_with_tie_rule_active"
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

// Phase 5J — split into ESSENTIAL_GROUP (visible by default) and
// ADVANCED_GROUPS (collapsed inside per-tab "Advanced" section).
// Hidden values for each market are in docs/CONFIG_HIDDEN.md.

const ESSENTIAL_GROUP: FieldGroup = {
  title: "Stake & payout bounds",
  hint: "The four operator dials per market. Edit weekly/monthly as the platform grows.",
  fields: [
    { key: "stake_min_usd", label: "Stake min ($)", hint: "Smallest allowed bet.", step: 1 },
    { key: "stake_max_usd", label: "Stake max ($)", hint: "Hard ceiling per ticket. Dynamic stake formula throttles below this for capped outcomes.", step: 1 },
    { key: "payout_max_usd", label: "Payout max ($)", hint: "Max payout-if-won per ticket.", step: 1 },
    { key: "cap_per_side_usd", label: "Per-user per-side cap ($)", hint: "Max combined liability per user per market per side.", step: 1 },
  ],
};

const ADVANCED_GROUPS: ReadonlyArray<FieldGroup> = [
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

// Combined for diff/save logic — order matters only for visual display
// (essentials first, then advanced when expanded).
const FIELD_GROUPS: ReadonlyArray<FieldGroup> = [ESSENTIAL_GROUP, ...ADVANCED_GROUPS];

interface GlobalFlags {
  speed_markets_enabled: boolean;
  speed_1m_markets_enabled: boolean;
  speed_gold_markets_enabled: boolean;
}

/**
 * Compute the effective live state of a market by AND-ing the three gates.
 * Returns either { live: true } or { live: false, blocker: "<reason>" } so
 * the UI can show admins exactly which gate is dark.
 */
function effectiveState(
  row: MarketRow,
  assetEnabled: Record<string, boolean>,
  flags: GlobalFlags,
): { live: boolean; blocker: string | null } {
  if (!flags.speed_markets_enabled) {
    return { live: false, blocker: "Master kill switch OFF (speed_markets_enabled)" };
  }
  if (!row.enabled) {
    return { live: false, blocker: "Per-row enabled OFF (toggle below)" };
  }
  if (assetEnabled[row.asset] === false) {
    return { live: false, blocker: `${row.asset} asset disabled (speed_assets.${row.asset}.enabled)` };
  }
  if (row.duration === "1m" && !flags.speed_1m_markets_enabled) {
    return { live: false, blocker: "1m global flag OFF (speed_1m_markets_enabled)" };
  }
  if (row.asset === "GOLD" && !flags.speed_gold_markets_enabled) {
    return { live: false, blocker: "Gold global flag OFF (speed_gold_markets_enabled)" };
  }
  return { live: true, blocker: null };
}

export function MarketsConfigEditor({
  markets,
  assetEnabled,
  flags,
}: {
  markets: MarketRow[];
  assetEnabled: Record<string, boolean>;
  flags: GlobalFlags;
}) {
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
  const activeEffective = active
    ? effectiveState(active, assetEnabled, flags)
    : null;

  return (
    <div>
      {/* Tab bar — each tab shows live/dark state badge */}
      <div className="flex flex-wrap gap-2 border-b border-[#e8eff3] mb-4">
        {markets.map((m) => {
          const k = `${m.asset}-${m.duration}`;
          const isActive = k === activeKey;
          const eff = effectiveState(m, assetEnabled, flags);
          return (
            <button
              key={k}
              onClick={() => setActiveKey(k)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                isActive
                  ? "border-[var(--yes,#2D8CFF)] text-[#2a3439]"
                  : "border-transparent text-[#566166] hover:text-[#2a3439]"
              } ${eff.live ? "" : "opacity-60"}`}
              type="button"
            >
              {m.asset} · {m.duration}
              <span
                className={`ms-2 text-[10px] uppercase tracking-wider ${
                  eff.live ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {eff.live ? "● live" : "○ dark"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Effective-state banner above the active tab */}
      {active && activeEffective && !activeEffective.live && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-4 text-xs">
          <div className="font-bold text-amber-900">
            ⚠ This market is NOT visible to users.
          </div>
          <div className="text-amber-800 mt-1">
            Reason: <strong>{activeEffective.blocker}</strong>.
          </div>
          <div className="text-amber-700 mt-1">
            Editing values below changes what would happen{" "}
            <em>if</em> the gate flips on. Saves don&apos;t expose the market.
          </div>
        </div>
      )}
      {active && activeEffective && activeEffective.live && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 mb-4 text-xs">
          <div className="font-bold text-emerald-900">
            ● This market is LIVE to users.
          </div>
          <div className="text-emerald-800 mt-1">
            All three gates are ON. Edits below take effect on the next quote.
          </div>
        </div>
      )}

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

  const setTieRuleEnabled = (v: boolean) => {
    setDraft((d) => ({ ...d, tie_loser_rule_enabled: v }));
  };

  const setTieLowStakeThreshold = (v: number) => {
    setDraft((d) => ({ ...d, tie_low_stake_threshold_usd: v }));
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
    if (draft.tie_loser_rule_enabled !== original.tie_loser_rule_enabled) {
      out.tie_loser_rule_enabled = draft.tie_loser_rule_enabled;
    }
    if (
      draft.tie_low_stake_threshold_usd !==
      original.tie_low_stake_threshold_usd
    ) {
      out.tie_low_stake_threshold_usd = draft.tie_low_stake_threshold_usd;
    }
    if ((draft.notes ?? "") !== (original.notes ?? "")) {
      out.notes = draft.notes ?? "";
    }
    return out;
  };

  const dirty = Object.keys(buildDiff()).length > 0;

  const handleSave = async () => {
    const diff = buildDiff();
    if (Object.keys(diff).length === 0) {
      setSaving(false);
      return;
    }

    // Master switch confirmation — toggling the enabled flag is high
    // blast radius (auto-cascades to asset gate + global flag, can take
    // a market live with real money or kill one full of open positions).
    // Require explicit confirmation before saving when enabled changes.
    if (diff.enabled !== undefined) {
      const turningOn = diff.enabled === true;
      const lines: string[] = [];
      if (turningOn) {
        lines.push(`Turn ON ${draft.asset} · ${draft.duration} for users?`);
        lines.push("");
        lines.push("This will cascade automatically:");
        lines.push("  • Set speed_market_config.enabled = TRUE");
        if (draft.asset === "GOLD") {
          lines.push("  • Set speed_assets.GOLD.enabled = TRUE");
          lines.push("  • Set speed_gold_markets_enabled = 1");
          lines.push("  • Worker redeploy required (PAXG ticks)");
        }
        if (draft.duration === "1m") {
          lines.push("  • Set speed_1m_markets_enabled = 1");
        }
        lines.push("");
        lines.push("Real users will see this market in seconds.");
        lines.push("Real money will start flowing through it.");
      } else {
        lines.push(`Turn OFF ${draft.asset} · ${draft.duration} for users?`);
        lines.push("");
        lines.push("This will:");
        lines.push("  • Set speed_market_config.enabled = FALSE");
        lines.push("  • Stop opening new markets of this type");
        lines.push("  • Existing OPEN positions resolve normally (NOT cancelled)");
        lines.push("  • Asset gate + global flag stay ON (other markets may need them)");
        lines.push("");
        lines.push("Frontend tab disappears. Existing positions are safe.");
      }
      lines.push("");
      lines.push("Type YES to confirm.");

      const confirmation = window.prompt(lines.join("\n"));
      if (confirmation !== "YES") {
        setMessage({ kind: "err", text: "Cancelled. No changes saved." });
        return;
      }
    }

    // 0055: tie-loser rule confirmation. Settlement-mechanic flip — needs
    // its own YES gate on FALSE → TRUE. (Turning OFF only affects future
    // markets; in-flight ones still settle under their snapshot.)
    if (
      diff.tie_loser_rule_enabled === true &&
      original.tie_loser_rule_enabled === false
    ) {
      const lines = [
        `Turn ON tie-loser settlement rule on ${draft.asset} · ${draft.duration}?`,
        "",
        "What changes:",
        "  • New markets opened from now will settle ties (close = strike)",
        "    against the heavier-stake side, instead of refunding everyone.",
        "  • Existing OPEN markets are unaffected — they snapshotted FALSE",
        "    at open and will keep settling pushes as legacy refunds.",
        "  • 1-minute markets only — 5m and 1h ignore this flag.",
        "",
        "Hard prerequisite: T&C section is published AND on-screen disclosure",
        "is visible on the trade ticket. Do not flip ON without both.",
        "",
        "Type YES to confirm.",
      ];
      const confirmation = window.prompt(lines.join("\n"));
      if (confirmation !== "YES") {
        setMessage({ kind: "err", text: "Cancelled. No changes saved." });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/markets-config/${draft.asset}/${draft.duration}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(diff),
        },
      );
      type CascadeInfo = {
        asset_enabled?: boolean;
        gold_global_flag?: number;
        onem_global_flag?: number;
        worker_redeploy_required?: boolean;
      };
      const json = (await res.json()) as
        | { ok: true; updated_fields: string[]; cascade?: CascadeInfo }
        | { error: string; issues?: string[] };
      if (!res.ok || !("ok" in json)) {
        const issues =
          "issues" in json && json.issues ? `: ${json.issues.join("; ")}` : "";
        const err = "error" in json ? json.error : "Save failed";
        setMessage({ kind: "err", text: `${err}${issues}` });
      } else {
        const cascade = json.cascade ?? {};
        const cascadeNotes: string[] = [];
        if (cascade.asset_enabled === true) cascadeNotes.push(`enabled ${draft.asset} asset`);
        if (cascade.gold_global_flag === 1) cascadeNotes.push("flipped global gold flag ON");
        if (cascade.onem_global_flag === 1) cascadeNotes.push("flipped global 1m flag ON");
        const cascadeText = cascadeNotes.length > 0
          ? ` Cascade: ${cascadeNotes.join("; ")}.`
          : "";
        const workerNote = cascade.worker_redeploy_required
          ? " ⚠ Worker redeploy required: run `bash scripts/deploy-paxg-oracle.sh` so PAXG ticks start streaming."
          : "";
        setMessage({
          kind: "ok",
          text: `Saved ${json.updated_fields.length} field${json.updated_fields.length === 1 ? "" : "s"}.${cascadeText}${workerNote} Refresh to confirm.`,
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
        <div className="text-right">
          <label
            className={`inline-flex items-center gap-2 text-sm cursor-pointer rounded-lg border px-3 py-2 ${
              draft.enabled
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            }`}
          >
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="font-bold">
              {draft.enabled ? "● Live to users" : "○ Hidden from users"}
            </span>
          </label>
          {draft.enabled !== original.enabled && (
            <p className="text-[10px] text-amber-700 mt-1 max-w-[260px]">
              ⚠ Press <strong>Save changes</strong> below to apply.
              {draft.enabled
                ? " Saving will auto-flip asset gate + global feature flag."
                : " Asset gate + global flag stay ON (other markets may use them)."}
            </p>
          )}
        </div>
      </div>

      {/* Essentials — always visible */}
      <FieldGroupBlock
        group={ESSENTIAL_GROUP}
        draft={draft}
        original={original}
        setField={setField}
      />

      {/* Advanced — collapsed by default. Reference values + change SQL
          in docs/CONFIG_HIDDEN.md. */}
      <AdvancedFieldsSection
        groups={ADVANCED_GROUPS}
        draft={draft}
        original={original}
        setField={setField}
      />

      {/* 0055: Tie-loser settlement rule (1m only). Snapshotted at market
          open onto speed_markets.tie_loser_rule_active. Live flips affect
          only NEW markets — in-flight markets settle under their own
          snapshot. */}
      <TieRuleSection
        row={row}
        draft={draft}
        original={original}
        setEnabled={setTieRuleEnabled}
        setThreshold={setTieLowStakeThreshold}
      />

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

function FieldGroupBlock({
  group,
  draft,
  original,
  setField,
}: {
  group: FieldGroup;
  draft: MarketRow;
  original: MarketRow;
  setField: (k: EditableNumericKey, v: number) => void;
}) {
  return (
    <fieldset className="border border-[#e8eff3] rounded-lg p-4">
      <legend className="px-2 text-xs font-bold uppercase tracking-[0.18em] text-[#566166]">
        {group.title}
      </legend>
      {group.hint && <p className="text-xs text-[#566166] mb-3">{group.hint}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {group.fields.map((f) => {
          const value = draft[f.key];
          const orig = original[f.key];
          const changed = value !== orig;
          return (
            <label key={f.key} className="block text-xs">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-[#2a3439]">{f.label}</span>
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
                onChange={(e) => setField(f.key, Number(e.target.value))}
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
  );
}

function AdvancedFieldsSection({
  groups,
  draft,
  original,
  setField,
}: {
  groups: ReadonlyArray<FieldGroup>;
  draft: MarketRow;
  original: MarketRow;
  setField: (k: EditableNumericKey, v: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Count changed fields inside Advanced — surface that count on the
  // collapsed header so a slip-edit can never go invisible.
  const advancedKeys = groups.flatMap((g) => g.fields.map((f) => f.key));
  const changedCount = advancedKeys.reduce(
    (acc, k) => (draft[k] !== original[k] ? acc + 1 : acc),
    0,
  );
  const totalCount = advancedKeys.length;

  return (
    <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-700 text-lg">
            tune
          </span>
          <div>
            <p className="text-sm font-bold text-[#2a3439]">
              Advanced (statistical) — {totalCount} fields
            </p>
            <p className="text-xs text-[#566166]">
              Pricing math, cashout coefficients, matrix calibration. Set
              once; rarely touched. Reference values in{" "}
              <code>docs/CONFIG_HIDDEN.md</code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {changedCount > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-900 bg-amber-200 px-2.5 py-1 rounded-full">
              {changedCount} edited
            </span>
          )}
          <span
            className="material-symbols-outlined text-amber-700 text-lg transition-transform duration-200"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            expand_more
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-amber-200/60 p-4 space-y-4 bg-white">
          {groups.map((g) => (
            <FieldGroupBlock
              key={g.title}
              group={g}
              draft={draft}
              original={original}
              setField={setField}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 0055 — Tie-loser settlement rule (1m only).
//
// Two fields:
//   - tie_loser_rule_enabled (boolean): master flag. Snapshotted onto
//     each new market at speed_roll_markets time, so flipping here only
//     affects NEW markets — in-flight markets settle under whatever
//     snapshot they were opened with.
//   - tie_low_stake_threshold_usd (numeric): below this total stake at
//     close, tie outcomes use a deterministic-from-md5(market_id)
//     fallback (no bias).
//
// Reads `row.open_with_tie_rule_active` (server-populated) to show
// admins how many in-flight markets opened with the rule active. After
// flipping OFF, this stays > 0 until the in-flight markets close.
function TieRuleSection({
  row,
  draft,
  original,
  setEnabled,
  setThreshold,
}: {
  row: MarketRow;
  draft: MarketRow;
  original: MarketRow;
  setEnabled: (v: boolean) => void;
  setThreshold: (v: number) => void;
}) {
  const enabledChanged =
    draft.tie_loser_rule_enabled !== original.tie_loser_rule_enabled;
  const thresholdChanged =
    draft.tie_low_stake_threshold_usd !== original.tie_low_stake_threshold_usd;
  const onlyApplies = row.duration === "1m";
  const inFlightSnapshot = row.open_with_tie_rule_active ?? 0;

  return (
    <fieldset className="border border-[#e8eff3] rounded-lg p-4 space-y-3">
      <legend className="px-2 text-xs font-bold uppercase tracking-[0.18em] text-[#566166]">
        Tie settlement rule (1m only)
      </legend>
      <p className="text-[11px] text-[#566166]">
        When the closing price equals the strike exactly, the heavier-stake
        side loses (no refund). Snapshotted at market open — flipping
        below only affects markets opened from now on.
      </p>
      {!onlyApplies && (
        <p className="text-[11px] text-amber-700">
          ⚠ This row is <strong>{row.duration}</strong>. The rule is read
          by <code>speed_roll_markets</code> at INSERT, but the resolver
          fires the tie path only on 1m. Editing here is harmless but
          has no effect on settlement.
        </p>
      )}
      <label
        className={`flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 ${
          draft.tie_loser_rule_enabled
            ? "border-emerald-300 bg-emerald-50"
            : "border-[#e8eff3] bg-white"
        }`}
      >
        <input
          type="checkbox"
          checked={draft.tie_loser_rule_enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="font-bold">
          {draft.tie_loser_rule_enabled
            ? "● Tie rule ON for new markets"
            : "○ Tie rule OFF (legacy push refund)"}
        </span>
        {enabledChanged && (
          <span className="ms-auto text-[10px] font-bold uppercase tracking-wider text-amber-700">
            ⚠ unsaved
          </span>
        )}
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2 items-center">
        <label className="text-xs font-semibold text-[#566166]">
          Low-stake threshold ($)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={draft.tie_low_stake_threshold_usd}
            onChange={(e) =>
              setThreshold(Number(e.target.value) || 0)
            }
            className={`w-32 rounded-md border px-2 py-1.5 text-sm ${
              thresholdChanged
                ? "border-amber-300 bg-amber-50"
                : "border-[#e8eff3] bg-white"
            }`}
          />
          <span className="text-[11px] text-[#566166]">
            Below this total open-position stake at close, ties pick a
            loser deterministically from <code>md5(market_id)</code>.
          </span>
        </div>
      </div>
      {inFlightSnapshot > 0 && (
        <p className="text-[11px] text-[#2a3439] bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
          <strong>{inFlightSnapshot}</strong> currently-open{" "}
          {row.asset}·{row.duration} markets opened with{" "}
          <code>tie_loser_rule_active = TRUE</code>. They will settle
          under the tie rule regardless of what you set above. New
          markets reflect the toggle on next roll.
        </p>
      )}
    </fieldset>
  );
}
