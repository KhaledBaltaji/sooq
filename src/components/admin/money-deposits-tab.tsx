"use client";

// Deposits tab on /admin/money.
// Two sub-views: Pending (Whish awaiting manual credit) and History
// (already verified — TRC20 auto-credits + sent Whish credits, read-only).
// "Credit" action calls /api/admin/deposits/credit which writes to the
// ledger via admin_credit_deposit.

import { useEffect, useState, useTransition } from "react";
import { Check, RefreshCw, Loader2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

interface AdminDeposit {
  id: string;
  user_id: string;
  user: {
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    balance_usd: number;
  };
  amount: number;
  currency: string;
  provider: string;
  provider_ref: string;
  status: "pending" | "verified" | "rejected" | "expired";
  proof_url: string | null;
  created_at: string;
  verified_at: string | null;
}

const SUB_TABS: { key: "pending" | "verified"; label: string }[] = [
  { key: "pending", label: "Pending Whish" },
  { key: "verified", label: "Credited (history)" },
];

export function MoneyDepositsTab() {
  const [sub, setSub] = useState<"pending" | "verified">("pending");
  const [rows, setRows] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = async (which: "pending" | "verified") => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/deposits/list?status=${which}&limit=200`);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Failed (${r.status})`);
      }
      const body = (await r.json()) as { deposits: AdminDeposit[] };
      setRows(body.deposits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows(sub);
  }, [sub]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
              sub === t.key
                ? "bg-[#2a3439] text-white"
                : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => fetchRows(sub)}
          className="ml-auto p-2 rounded-md text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7]"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#566166] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-[#566166]">
            {sub === "pending"
              ? "No Whish deposits awaiting credit."
              : "No verified deposits in range."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                <th className="text-left px-5 py-3">User</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Provider</th>
                <th className="text-left px-5 py-3">Reference</th>
                <th className="text-left px-5 py-3">{sub === "pending" ? "Requested" : "Credited"}</th>
                {sub === "pending" && <th className="text-right px-5 py-3">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <DepositRow key={r.id} row={r} sub={sub} onChange={() => fetchRows(sub)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DepositRow({
  row,
  sub,
  onChange,
}: {
  row: AdminDeposit;
  sub: "pending" | "verified";
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const date = new Date(sub === "pending" ? row.created_at : row.verified_at ?? row.created_at);

  const onCredit = () => {
    if (
      !confirm(
        `Credit ${formatCurrency(row.amount)} to ${row.user.email}? This writes a verified deposit row + ledger entry. Action cannot be undone — only via a manual debit.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await fetch(`/api/admin/deposits/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: row.user_id,
          amount: row.amount,
          provider_ref: row.provider_ref,
          notes: null,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `Failed (${r.status})`);
        return;
      }
      onChange();
    });
  };

  return (
    <tr className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc]">
      <td className="px-5 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-[#2a3439]">
            {row.user.display_name ?? row.user.email ?? "—"}
          </span>
          <span className="text-xs text-[#717c82]">{row.user.email}</span>
          <span className="text-[10px] text-[#717c82]">
            balance {formatCurrency(row.user.balance_usd)}
          </span>
        </div>
      </td>
      <td className="px-5 py-3 text-right tabular-nums font-bold text-[#2a3439]">
        {formatCurrency(row.amount)}
      </td>
      <td className="px-5 py-3 capitalize">{row.provider}</td>
      <td className="px-5 py-3 font-mono text-xs break-all max-w-[280px] text-[#566166]">
        {row.provider_ref}
      </td>
      <td className="px-5 py-3 text-xs text-[#566166]">{date.toLocaleString()}</td>
      {sub === "pending" && (
        <td className="px-5 py-3 text-right">
          <button
            type="button"
            onClick={onCredit}
            disabled={pending}
            className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Credit
          </button>
          {error && (
            <p className="text-[10px] text-red-600 mt-1 text-right">{error}</p>
          )}
        </td>
      )}
    </tr>
  );
}
