"use client";

// Phase 5K — Money tab. Deposits in / Withdrawals out / Fees / Balance held.
// Plus pending-withdrawals + recent-deposits mini-tables.

import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  Coins,
  Loader2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Kpi } from "./stats-kpi";

interface MoneyKpi {
  deposits_in: number;
  withdrawals_out: number;
  withdrawal_fees: number;
  total_balance_held: number;
}

interface PendingWithdrawal {
  id: string;
  user_email: string | null;
  amount: number;
  fee_amount: number | null;
  method: string;
  status: string;
  created_at: string;
}

interface RecentDeposit {
  id: string;
  user_email: string | null;
  amount: number;
  status: string;
  currency: string | null;
  provider: string | null;
  created_at: string;
}

interface MoneyResponse {
  kpi: MoneyKpi;
  pending_withdrawals: PendingWithdrawal[];
  recent_deposits: RecentDeposit[];
}

export function StatsMoneyTab({
  isoRange,
}: {
  isoRange: { from: string | null; to: string | null };
}) {
  const [data, setData] = useState<MoneyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (isoRange.from) params.set("from", isoRange.from);
    if (isoRange.to) params.set("to", isoRange.to);
    fetch(`/api/admin/stats/money-summary?${params.toString()}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j: MoneyResponse | { error: string }) => {
        if ("error" in j) setErr(j.error);
        else setData(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e.message ?? "Load failed");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [isoRange.from, isoRange.to]);

  if (err) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {err}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Deposits in"
          value={data ? formatCurrency(data.kpi.deposits_in) : "—"}
          icon={<ArrowDownToLine className="w-4 h-4" />}
          tone="good"
          hint="Verified deposits in range"
        />
        <Kpi
          label="Withdrawals out"
          value={data ? formatCurrency(data.kpi.withdrawals_out) : "—"}
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          tone="muted"
          hint="Sent withdrawals in range"
        />
        <Kpi
          label="Withdrawal fees"
          value={data ? formatCurrency(data.kpi.withdrawal_fees) : "—"}
          icon={<Coins className="w-4 h-4" />}
          tone="muted"
          hint="Fees on sent withdrawals"
        />
        <Kpi
          label="User balance held"
          value={data ? formatCurrency(data.kpi.total_balance_held) : "—"}
          icon={<Wallet className="w-4 h-4" />}
          tone="muted"
          hint="Point-in-time across all users"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <h4 className="text-sm font-bold text-[#2a3439] mb-2">
            Pending withdrawals (top 10 by amount)
          </h4>
          <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
            {loading && !data ? (
              <Loader />
            ) : !data || data.pending_withdrawals.length === 0 ? (
              <Empty>No pending withdrawals.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Method</th>
                    <th className="text-right px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pending_withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      className="border-b border-[#e9ecef]/60 last:border-b-0"
                    >
                      <td className="px-4 py-3 text-xs text-[#566166] truncate max-w-[180px]">
                        {w.user_email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">{w.method}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatCurrency(w.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span
                          className={
                            w.status === "approved"
                              ? "text-emerald-700"
                              : "text-amber-700"
                          }
                        >
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-[#2a3439] mb-2">
            Recent deposits (last 20)
          </h4>
          <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
            {loading && !data ? (
              <Loader />
            ) : !data || data.recent_deposits.length === 0 ? (
              <Empty>No deposits yet.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Provider</th>
                    <th className="text-right px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_deposits.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-[#e9ecef]/60 last:border-b-0"
                    >
                      <td className="px-4 py-3 text-xs text-[#566166] truncate max-w-[180px]">
                        {d.user_email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">{d.provider ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatCurrency(d.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span
                          className={
                            d.status === "verified"
                              ? "text-emerald-700"
                              : d.status === "rejected"
                                ? "text-red-700"
                                : "text-[#566166]"
                          }
                        >
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div className="p-8 text-center text-[#566166]">
      <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
      Loading…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-8 text-center text-[#566166] text-sm">{children}</div>;
}
