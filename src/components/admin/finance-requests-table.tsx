"use client";

import { useMemo } from "react";
import { WithdrawalActions } from "@/components/admin/withdrawal-actions";
import { DepositActions } from "@/components/admin/deposit-actions";
import { DepositProofViewer } from "@/components/admin/deposit-proof-viewer";
import { formatCurrency } from "@/lib/utils";

interface RequestItem {
  id: string;
  type: "deposit" | "withdrawal";
  amount: number;
  fee: number;
  net_amount: number;
  created_at: string;
  display_name: string;
  phone: string | null;
  status: string;
  // manual deposit fields
  provider?: string;
  proof_image_url?: string | null;
  whish_number?: string | null;
}

interface FinanceRequestsTableProps {
  deposits: any[];
  withdrawals: any[];
}

export function FinanceRequestsTable({ deposits, withdrawals }: FinanceRequestsTableProps) {
  const requests = useMemo(() => {
    const pendingDeposits: RequestItem[] = deposits
      .filter((d: any) => d.status === "pending" || d.status === "pending_review")
      .map((d: any) => ({
        id: d.id,
        type: "deposit" as const,
        amount: d.amount,
        fee: d.fee,
        net_amount: d.net_amount,
        created_at: d.created_at,
        display_name: d.users?.display_name || d.users?.phone || "Unknown",
        phone: d.users?.phone,
        status: d.status,
        provider: d.provider,
        proof_image_url: d.proof_image_url,
        whish_number: d.whish_number,
      }));

    const pendingWithdrawals: RequestItem[] = withdrawals
      .filter((w: any) => w.status === "pending")
      .map((w: any) => ({
        id: w.id,
        type: "withdrawal" as const,
        amount: w.amount,
        fee: w.fee,
        net_amount: w.net_amount,
        created_at: w.created_at,
        display_name: w.users?.display_name || w.users?.phone || "Unknown",
        phone: w.users?.phone,
        status: w.status,
      }));

    return [...pendingDeposits, ...pendingWithdrawals].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [deposits, withdrawals]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const initials = (name: string | null) => {
    if (!name) return "??";
    return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7] text-left">
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">User</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Type</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Amount</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Fee</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Net</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Date</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center">
                  <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">check_circle</span>
                  <p className="text-sm font-medium text-[#566166]">No pending requests</p>
                  <p className="text-xs text-[#a9b4b9] mt-1">All deposit and withdrawal requests have been processed</p>
                </td>
              </tr>
            ) : (
              requests.map((r, i) => (
                <tr
                  key={`${r.type}-${r.id}`}
                  className={`hover:bg-[#f0f4f7]/50 transition-colors ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                >
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#d5e3fc] flex items-center justify-center text-[10px] font-bold text-[#455367]">
                        {initials(r.display_name)}
                      </div>
                      <span className="text-sm font-semibold text-[#2a3439]">{r.display_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full ${
                      r.type === "deposit"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}>
                      {r.type}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right text-sm font-medium text-[#2a3439] tabular-nums">
                    {formatCurrency(r.amount)}
                  </td>
                  <td className="px-6 py-5 text-right text-sm text-[#566166] tabular-nums">
                    {formatCurrency(r.fee)}
                  </td>
                  <td className="px-6 py-5 text-right text-sm font-bold text-[#2a3439] tabular-nums">
                    {formatCurrency(r.net_amount)}
                  </td>
                  <td className="px-6 py-5 text-sm text-[#566166] whitespace-nowrap">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-6 py-5 text-center">
                    {r.type === "withdrawal" ? (
                      <WithdrawalActions
                        withdrawal={{
                          id: r.id,
                          amount: r.amount,
                          user_name: r.display_name,
                          net_amount: r.net_amount,
                          status: r.status,
                        }}
                      />
                    ) : r.provider === "whish_manual" ? (
                      <div className="flex items-center justify-center gap-3">
                        {r.proof_image_url && (
                          <DepositProofViewer path={r.proof_image_url} />
                        )}
                        <DepositActions
                          deposit={{
                            id: r.id,
                            amount: r.amount,
                            net_amount: r.net_amount,
                            user_name: r.display_name,
                            status: r.status,
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-[#a9b4b9]">Auto</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
