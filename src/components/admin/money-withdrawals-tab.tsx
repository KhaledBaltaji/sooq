"use client";

// Withdrawal requests tab on /admin/money.
// Two sub-views: Pending (needs approve/reject) and Approved (awaiting send).
// History (sent + rejected) lives on the unified History tab — every
// completed money movement is visible there via the transactions ledger.

import { useEffect, useState, useTransition } from "react";
import { Check, X, Send, RefreshCw, Loader2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

type WithdrawalStatus = "pending" | "approved" | "rejected" | "sent";

interface AdminWithdrawal {
  id: string;
  user_id: string;
  user: {
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    balance_usd: number;
  };
  amount: number;
  fee_amount: number;
  net_amount: number | null;
  method: string;
  account_details: Record<string, unknown> | null;
  status: WithdrawalStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
}

const SUB_TABS: { key: "pending" | "approved"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved (awaiting send)" },
];

export function MoneyWithdrawalsTab() {
  const [sub, setSub] = useState<"pending" | "approved">("pending");
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSub = async (which: "pending" | "approved") => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/withdrawals/list?status=${which}&limit=200`);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Failed (${r.status})`);
      }
      const body = (await r.json()) as { withdrawals: AdminWithdrawal[] };
      setRows(body.withdrawals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSub(sub);
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
          onClick={() => fetchSub(sub)}
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
              ? "No pending withdrawals."
              : "No approved withdrawals awaiting send."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                <th className="text-left px-5 py-3">User</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Method</th>
                <th className="text-left px-5 py-3">Destination</th>
                <th className="text-left px-5 py-3">Requested</th>
                <th className="text-right px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} row={r} sub={sub} onChange={() => fetchSub(sub)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({
  row,
  sub,
  onChange,
}: {
  row: AdminWithdrawal;
  sub: "pending" | "approved";
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = async (
    action: "approve" | "reject" | "mark-sent",
    body: Record<string, unknown> = {}
  ) => {
    setError(null);
    startTransition(async () => {
      const r = await fetch(`/api/admin/withdrawals/${row.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setError(b.error ?? `Failed (${r.status})`);
        return;
      }
      onChange();
    });
  };

  const sendAmount = row.net_amount ?? row.amount;
  const onApprove = () => {
    const msg =
      row.fee_amount > 0
        ? `Approve withdrawal: send ${formatCurrency(sendAmount)} to ${row.user.email}? (gross ${formatCurrency(row.amount)} − fee ${formatCurrency(row.fee_amount)})`
        : `Approve withdrawal of ${formatCurrency(row.amount)} to ${row.user.email}?`;
    if (!confirm(msg)) return;
    void submit("approve");
  };
  const onReject = () => {
    const notes = prompt("Reason for rejection (optional):") ?? null;
    if (
      !confirm(
        `Reject and refund ${formatCurrency(row.amount)} (gross) to ${row.user.email}?`
      )
    )
      return;
    void submit("reject", { notes });
  };
  const onMarkSent = () => {
    const ref = prompt(
      "External reference (Whish tx id / blockchain hash / bank wire ref):"
    );
    if (!ref || !ref.trim()) return;
    void submit("mark-sent", { external_reference: ref.trim() });
  };

  const dest = formatDestination(row.method, row.account_details);
  const reqAt = new Date(row.created_at);

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
      <td className="px-5 py-3 text-right tabular-nums">
        <div className="font-bold text-[#2a3439]">{formatCurrency(row.amount)}</div>
        {row.fee_amount > 0 && row.net_amount !== null && (
          <div className="text-[10px] text-[#717c82] leading-tight mt-0.5">
            send <span className="font-mono">{formatCurrency(row.net_amount)}</span>
            <span className="text-[#a3aaaf]"> · fee {formatCurrency(row.fee_amount)}</span>
          </div>
        )}
      </td>
      <td className="px-5 py-3 capitalize">{row.method}</td>
      <td className="px-5 py-3 font-mono text-xs break-all max-w-[260px]">{dest}</td>
      <td className="px-5 py-3 text-xs text-[#566166]">{reqAt.toLocaleString()}</td>
      <td className="px-5 py-3 text-right">
        {sub === "pending" && row.status === "pending" && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={pending}
              className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={pending}
              className="inline-flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        )}
        {sub === "approved" && row.status === "approved" && (
          <button
            type="button"
            onClick={onMarkSent}
            disabled={pending}
            className="inline-flex items-center gap-1 bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> Mark sent
          </button>
        )}
        {error && <p className="text-[10px] text-red-600 mt-1 text-right">{error}</p>}
      </td>
    </tr>
  );
}

function formatDestination(
  method: string,
  details: Record<string, unknown> | null
): string {
  if (!details) return "—";
  if (method === "whish") return String(details.phone ?? "—");
  if (method === "crypto")
    return `${String(details.network ?? "")} · ${String(details.address ?? "—")}`;
  if (method === "bank") return String(details.account ?? details.iban ?? "—");
  return JSON.stringify(details);
}
