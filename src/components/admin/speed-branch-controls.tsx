"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabase } from "@/components/providers/supabase-provider";
import { cn, formatCurrency } from "@/lib/utils";

interface SpeedBranchRow {
  branch_id: string;
  speed_status: "inactive" | "active" | "warning" | "frozen" | "suspended";
  speed_pool_balance: number | string;
  fee_share_pct: number | string;
  freeze_warn_pct: number | string;
  freeze_hard_pct: number | string;
  unfreeze_pct: number | string;
  stake_min: number | string;
  stake_max: number | string;
  stake_caps_per_side: Record<string, number>;
  activated_at: string | null;
  suspension_reason: string | null;
}

interface SpeedPoolEntry {
  id: string;
  type: string;
  amount: number | string;
  balance_after: number | string;
  description: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  inactive: { label: "Inactive", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  warning: { label: "Warning", variant: "outline" },
  frozen: { label: "Frozen", variant: "destructive" },
  suspended: { label: "Suspended", variant: "destructive" },
};

export function SpeedBranchControls({
  branchId,
  isReseller,
  speedRow,
  recentLedger,
}: {
  branchId: string;
  isReseller: boolean;
  speedRow: SpeedBranchRow | null;
  recentLedger: SpeedPoolEntry[];
}) {
  const supabase = useSupabase();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(rpc: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const { data, error } = await supabase.rpc(rpc as never, args as never);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return null;
    }
    setMsg(`OK: ${rpc}`);
    if (typeof window !== "undefined") setTimeout(() => window.location.reload(), 800);
    return data;
  }

  if (!isReseller) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-destructive" />
          <h3 className="text-base font-bold uppercase tracking-wide">Speed Markets</h3>
        </div>
        <div className="rounded-xl border border-border-custom bg-surface p-5 text-sm text-muted-custom">
          Speed-markets enable form is only available for <span className="font-bold">reseller</span> branches.
          Commission branches earn fee share automatically when their referred users place speed bets,
          without posting collateral or extra setup.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-destructive" />
        <h3 className="text-base font-bold uppercase tracking-wide">Speed Markets</h3>
        {speedRow && (
          <Badge variant={STATUS_BADGE[speedRow.speed_status].variant}>
            {STATUS_BADGE[speedRow.speed_status].label}
          </Badge>
        )}
      </div>

      <div className="rounded-xl border border-border-custom bg-surface p-5 space-y-4">
        {!speedRow ? (
          <EnableForm
            branchId={branchId}
            onSubmit={call}
            pin={pin}
            setPin={setPin}
            busy={busy}
          />
        ) : (
          <>
            <ActiveSummary row={speedRow} />
            <CollateralForms
              branchId={branchId}
              onSubmit={call}
              pin={pin}
              setPin={setPin}
              busy={busy}
            />
            <StatusControls
              branchId={branchId}
              row={speedRow}
              onSubmit={call}
              pin={pin}
              setPin={setPin}
              busy={busy}
            />
            {recentLedger.length > 0 && <RecentLedger entries={recentLedger} />}
          </>
        )}

        {err && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
            {err}
          </div>
        )}
        {msg && (
          <div className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success ring-1 ring-success/30">
            {msg}
          </div>
        )}
      </div>
    </section>
  );
}

function EnableForm({
  branchId,
  onSubmit,
  pin,
  setPin,
  busy,
}: {
  branchId: string;
  onSubmit: (rpc: string, args: Record<string, unknown>) => void;
  pin: string;
  setPin: (s: string) => void;
  busy: boolean;
}) {
  const [collateral, setCollateral] = useState("5000");
  const [feeShare, setFeeShare] = useState("0.30");
  const [warn, setWarn] = useState("0.20");
  const [hard, setHard] = useState("0.05");
  const [unfreeze, setUnfreeze] = useState("0.30");
  const [stakeMin, setStakeMin] = useState("1");
  const [stakeMax, setStakeMax] = useState("500");
  const [cap5m, setCap5m] = useState("200");
  const [cap15m, setCap15m] = useState("500");
  const [cap1h, setCap1h] = useState("1000");
  const [cap24h, setCap24h] = useState("2000");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-custom">
        Speed enable: posts initial collateral, sets per-branch params, and routes speed-bet
        variance to this branch&apos;s pool.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Collateral (USD)">
          <Input value={collateral} onChange={(e) => setCollateral(e.target.value)} type="number" min={1} />
        </Field>
        <Field label="Fee share %">
          <Input value={feeShare} onChange={(e) => setFeeShare(e.target.value)} type="number" min={0} max={1} step={0.01} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Warn at %">
          <Input value={warn} onChange={(e) => setWarn(e.target.value)} type="number" step={0.01} />
        </Field>
        <Field label="Hard freeze %">
          <Input value={hard} onChange={(e) => setHard(e.target.value)} type="number" step={0.01} />
        </Field>
        <Field label="Unfreeze %">
          <Input value={unfreeze} onChange={(e) => setUnfreeze(e.target.value)} type="number" step={0.01} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Stake min ($)">
          <Input value={stakeMin} onChange={(e) => setStakeMin(e.target.value)} type="number" />
        </Field>
        <Field label="Stake max ($)">
          <Input value={stakeMax} onChange={(e) => setStakeMax(e.target.value)} type="number" />
        </Field>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-custom mb-2">Per-side cap per market ($)</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="5m"><Input value={cap5m} onChange={(e) => setCap5m(e.target.value)} type="number" /></Field>
          <Field label="1h"><Input value={cap1h} onChange={(e) => setCap1h(e.target.value)} type="number" /></Field>
        </div>
        {/* Mig 361 dropped 15m, mig 363 dropped 24h. Active offering is 5m + 1h.
            All four keys still go in the RPC payload with sane defaults so the
            admin RPC contract (which expects all four) doesn't reject the call. */}
      </div>

      <Field label="Admin PIN">
        <Input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="••••" />
      </Field>

      <Button
        type="button"
        size="lg"
        disabled={busy || !pin}
        onClick={() =>
          onSubmit("speed_admin_enable_branch", {
            p_branch_id: branchId,
            p_collateral: Number(collateral),
            p_fee_share_pct: Number(feeShare),
            p_freeze_warn_pct: Number(warn),
            p_freeze_hard_pct: Number(hard),
            p_unfreeze_pct: Number(unfreeze),
            p_stake_min: Number(stakeMin),
            p_stake_max: Number(stakeMax),
            p_stake_caps_per_side: {
              "5m": Number(cap5m),
              "15m": Number(cap15m),
              "1h": Number(cap1h),
              "24h": Number(cap24h),
            },
            p_pin: pin,
          })
        }
        className="w-full"
      >
        {busy ? "…" : "Enable Speed Markets"}
      </Button>
    </div>
  );
}

function ActiveSummary({ row }: { row: SpeedBranchRow }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Pool balance" value={formatCurrency(Number(row.speed_pool_balance))} />
      <Stat label="Fee share %" value={`${(Number(row.fee_share_pct) * 100).toFixed(1)}%`} />
      <Stat label="Stake range" value={`$${row.stake_min} – $${row.stake_max}`} />
      <Stat label="Activated" value={row.activated_at ? new Date(row.activated_at).toLocaleDateString() : "—"} />
    </div>
  );
}

function CollateralForms({
  branchId,
  onSubmit,
  pin,
  setPin,
  busy,
}: {
  branchId: string;
  onSubmit: (rpc: string, args: Record<string, unknown>) => void;
  pin: string;
  setPin: (s: string) => void;
  busy: boolean;
}) {
  const [credit, setCredit] = useState("");
  const [creditNotes, setCreditNotes] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [withdrawNotes, setWithdrawNotes] = useState("");

  return (
    <div className="grid md:grid-cols-2 gap-4 border-t border-border-custom pt-4">
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-custom font-bold">Credit collateral</div>
        <Input value={credit} onChange={(e) => setCredit(e.target.value)} type="number" placeholder="Amount" />
        <Input value={creditNotes} onChange={(e) => setCreditNotes(e.target.value)} placeholder="Notes (optional)" />
        <Input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="PIN" />
        <Button
          type="button"
          variant="default"
          disabled={busy || !pin || !credit}
          onClick={() =>
            onSubmit("speed_admin_collateral_credit", {
              p_branch_id: branchId,
              p_amount: Number(credit),
              p_notes: creditNotes || null,
              p_pin: pin,
            })
          }
          className="w-full"
        >
          Credit
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-custom font-bold">Withdraw collateral</div>
        <Input value={withdraw} onChange={(e) => setWithdraw(e.target.value)} type="number" placeholder="Amount" />
        <Input value={withdrawNotes} onChange={(e) => setWithdrawNotes(e.target.value)} placeholder="Notes (optional)" />
        <Input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="PIN" />
        <Button
          type="button"
          variant="destructive"
          disabled={busy || !pin || !withdraw}
          onClick={() =>
            onSubmit("speed_admin_collateral_withdraw", {
              p_branch_id: branchId,
              p_amount: Number(withdraw),
              p_notes: withdrawNotes || null,
              p_pin: pin,
            })
          }
          className="w-full"
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
}

function StatusControls({
  branchId,
  row,
  onSubmit,
  pin,
  setPin,
  busy,
}: {
  branchId: string;
  row: SpeedBranchRow;
  onSubmit: (rpc: string, args: Record<string, unknown>) => void;
  pin: string;
  setPin: (s: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");

  const isFrozen = row.speed_status === "frozen" || row.speed_status === "warning";
  const isActive = row.speed_status === "active";

  return (
    <div className="border-t border-border-custom pt-4 space-y-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-custom font-bold">Operational controls</div>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required for freeze/suspend)" />
      <Input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="PIN" />
      <div className="grid grid-cols-3 gap-2">
        {isActive && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !pin || !reason}
            onClick={() => onSubmit("speed_admin_freeze_branch", { p_branch_id: branchId, p_reason: reason, p_pin: pin })}
          >
            Freeze
          </Button>
        )}
        {isFrozen && (
          <Button
            type="button"
            variant="default"
            disabled={busy || !pin}
            onClick={() => onSubmit("speed_admin_unfreeze_branch", { p_branch_id: branchId, p_pin: pin })}
          >
            Unfreeze
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={busy || !pin || !reason || row.speed_status === "suspended"}
          onClick={() => onSubmit("speed_admin_suspend_branch", { p_branch_id: branchId, p_reason: reason, p_pin: pin })}
        >
          Suspend
        </Button>
      </div>
    </div>
  );
}

function RecentLedger({ entries }: { entries: SpeedPoolEntry[] }) {
  return (
    <div className="border-t border-border-custom pt-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-custom font-bold mb-2">Recent pool activity</div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-xs rounded bg-bg px-3 py-2">
            <div>
              <span className="font-mono text-muted-custom">{e.type}</span>
              {e.description && <span className="ml-2 text-muted-custom">· {e.description}</span>}
            </div>
            <span className={cn("font-satoshi font-bold tabular-nums", Number(e.amount) >= 0 ? "text-success" : "text-destructive")}>
              {Number(e.amount) >= 0 ? "+" : ""}
              {formatCurrency(Number(e.amount))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-custom mb-1">{label}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-custom">{label}</div>
      <div className="font-satoshi text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
