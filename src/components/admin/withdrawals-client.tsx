"use client";

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
  method: string;
  account_details: Record<string, unknown> | null;
  status: WithdrawalStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  notes: string | null;
  created_at: string;
}

const TABS: { key: "pending" | "approved" | "history"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved (awaiting send)" },
  { key: "history", label: "History" },
];

export function WithdrawalsClient() {
  const [tab, setTab] = useState<"pending" | "approved" | "history">("pending");
  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTab = async (which: "pending" | "approved" | "history") => {
    setLoading(true);
    setError(null);
    try {
      // History = both rejected + sent. We do two fetches and merge.
      if (which === "history") {
        const [a, b] = await Promise.all([
          fetch(`/api/admin/withdrawals/list?status=rejected&limit=100`).then(
            (r) => r.json()
          ),
          fetch(`/api/admin/withdrawals/list?status=sent&limit=100`).then((r) =>
            r.json()
          ),
        ]);
        const merged = [...(a.withdrawals ?? []), ...(b.withdrawals ?? [])].sort(
          (x: AdminWithdrawal, y: AdminWithdrawal) =>
            (y.reviewed_at ?? y.created_at).localeCompare(
              x.reviewed_at ?? x.created_at
            )
        );
        setRows(merged);
      } else {
        const r = await fetch(
          `/api/admin/withdrawals/list?status=${which}&limit=100`
        );
        if (!r.ok) throw new Error(`Failed (${r.status})`);
        const body = (await r.json()) as { withdrawals: AdminWithdrawal[] };
        setRows(body.withdrawals);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTab(tab);
  }, [tab]);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              tab === t.key
                ? "bg-[#2d6cdf] text-white"
                : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]"
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => fetchTab(tab)}
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

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#566166] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-[#566166]">
            {tab === "pending"
              ? "No pending withdrawals. 🎉"
              : tab === "approved"
                ? "No approved withdrawals awaiting send."
                : "No history yet."}
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
                <Row
                  key={r.id}
                  row={r}
                  onChange={() => fetchTab(tab)}
                  tab={tab}
                />
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
  onChange,
  tab,
}: {
  row: AdminWithdrawal;
  onChange: () => void;
  tab: "pending" | "approved" | "history";
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

  const onApprove = () => {
    if (!confirm(`Approve withdrawal of ${formatCurrency(row.amount)} to ${row.user.email}?`))
      return;
    void submit("approve");
  };
  const onReject = () => {
    const notes = prompt("Reason for rejection (optional):") ?? null;
    if (!confirm(`Reject and refund ${formatCurrency(row.amount)} to ${row.user.email}?`))
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
      <td className="px-5 py-3 text-right tabular-nums font-bold">
        {formatCurrency(row.amount)}
      </td>
      <td className="px-5 py-3 capitalize">{row.method}</td>
      <td className="px-5 py-3 font-mono text-xs break-all max-w-[260px]">
        {dest}
      </td>
      <td className="px-5 py-3 text-xs text-[#566166]">
        {reqAt.toLocaleString()}
      </td>
      <td className="px-5 py-3 text-right">
        {tab === "pending" && row.status === "pending" && (
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
        {tab === "approved" && row.status === "approved" && (
          <button
            type="button"
            onClick={onMarkSent}
            disabled={pending}
            className="inline-flex items-center gap-1 bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> Mark sent
          </button>
        )}
        {tab === "history" && (
          <span
            className={cn(
              "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded",
              row.status === "sent"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            )}
          >
            {row.status}
          </span>
        )}
        {error && (
          <p className="text-[10px] text-red-600 mt-1 text-right">{error}</p>
        )}
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
  if (method === "bank")
    return String(details.account ?? details.iban ?? "—");
  return JSON.stringify(details);
}
