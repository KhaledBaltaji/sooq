"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";

interface TransactionDetail {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  description: string | null;
  performed_by?: string | null;
  created_at: string;
  users?: { display_name: string | null; phone: string | null } | null;
  performer?: { display_name: string | null } | null;
}

interface DepositDetail {
  id: string;
  user_id?: string;
  amount: number;
  fee: number;
  net_amount: number;
  currency: string;
  provider: string | null;
  provider_ref?: string | null;
  proof_image_url?: string | null;
  whish_number?: string | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  users?: { display_name: string | null; phone: string | null } | null;
}

interface WithdrawalDetail {
  id: string;
  user_id?: string;
  amount: number;
  fee: number;
  net_amount: number;
  destination?: string | null;
  status: string;
  admin_notes?: string | null;
  created_at: string;
  processed_at?: string | null;
  users?: { display_name: string | null; phone: string | null } | null;
}

type DetailData = TransactionDetail | DepositDetail | WithdrawalDetail;

interface TransactionDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DetailData | null;
  type: "transaction" | "deposit" | "withdrawal";
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  deposit: { label: "Deposit", color: "text-emerald-700", bg: "bg-emerald-50" },
  withdrawal: { label: "Withdrawal", color: "text-amber-700", bg: "bg-amber-50" },
  trade: { label: "Trade", color: "text-blue-700", bg: "bg-blue-50" },
  close_position: { label: "Cash Out", color: "text-violet-700", bg: "bg-violet-50" },
  commission: { label: "Commission", color: "text-indigo-700", bg: "bg-indigo-50" },
  bonus: { label: "Bonus", color: "text-pink-700", bg: "bg-pink-50" },
  refund: { label: "Refund", color: "text-teal-700", bg: "bg-teal-50" },
  resolution_payout: { label: "Payout", color: "text-emerald-700", bg: "bg-emerald-50" },
  resolution_fee: { label: "Res. Fee", color: "text-orange-700", bg: "bg-orange-50" },
  bet: { label: "Trade", color: "text-sky-700", bg: "bg-sky-50" },
  win: { label: "Win", color: "text-green-700", bg: "bg-green-50" },
  seed: { label: "Seed", color: "text-gray-700", bg: "bg-gray-100" },
  admin_credit: { label: "Admin Credit", color: "text-emerald-700", bg: "bg-emerald-50" },
  admin_debit: { label: "Admin Debit", color: "text-red-700", bg: "bg-red-50" },
  agent_transfer_out: { label: "Agent Out", color: "text-amber-700", bg: "bg-amber-50" },
  agent_transfer_in: { label: "Agent In", color: "text-emerald-700", bg: "bg-emerald-50" },
};

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  pending: { color: "text-amber-700", bg: "bg-amber-50" },
  pending_review: { color: "text-blue-700", bg: "bg-blue-50" },
  confirmed: { color: "text-emerald-700", bg: "bg-emerald-50" },
  approved: { color: "text-emerald-700", bg: "bg-emerald-50" },
  rejected: { color: "text-red-700", bg: "bg-red-50" },
  failed: { color: "text-red-700", bg: "bg-red-50" },
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-[#a9b4b9]/10 last:border-0">
      <span className="text-xs font-bold text-[#566166] uppercase tracking-wider">{label}</span>
      <span className={`text-sm text-[#2a3439] text-right max-w-[60%] break-all ${mono ? "font-mono text-xs" : "font-semibold"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

function TransactionDetails({ data }: { data: TransactionDetail }) {
  const typeConf = TYPE_LABELS[data.type] || { label: data.type, color: "text-gray-700", bg: "bg-gray-100" };
  const isPositive = data.amount >= 0;
  const userName = data.users?.display_name || data.users?.phone || "Unknown";

  return (
    <div className="space-y-1">
      <DetailRow label="User" value={userName} />
      <DetailRow
        label="Type"
        value={
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${typeConf.bg} ${typeConf.color}`}>
            {typeConf.label}
          </span>
        }
      />
      <DetailRow
        label="Amount"
        value={
          <span className={isPositive ? "text-emerald-600" : "text-[var(--error)]"}>
            {isPositive ? "+" : ""}{formatCurrency(Math.abs(data.amount))}
          </span>
        }
      />
      <DetailRow label="Balance After" value={formatCurrency(data.balance_after)} />
      <DetailRow label="Description" value={data.description} />
      <DetailRow label="Reference ID" value={data.reference_id} mono />
      <DetailRow label="Transaction ID" value={data.id} mono />
      {(data.type === "admin_credit" || data.type === "admin_debit") && data.performer && (
        <DetailRow label="Performed By" value={data.performer.display_name || "Admin"} />
      )}
      <DetailRow label="Date" value={formatDate(data.created_at)} />
    </div>
  );
}

function DepositDetails({ data }: { data: DepositDetail }) {
  const statusConf = STATUS_STYLES[data.status] || { color: "text-gray-700", bg: "bg-gray-100" };
  const userName = data.users?.display_name || data.users?.phone || "Unknown";

  return (
    <div className="space-y-1">
      <DetailRow label="User" value={userName} />
      <DetailRow
        label="Status"
        value={
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusConf.bg} ${statusConf.color} capitalize`}>
            {data.status}
          </span>
        }
      />
      <DetailRow label="Amount" value={<span className="text-emerald-600">+{formatCurrency(data.amount)}</span>} />
      <DetailRow label="Fee" value={formatCurrency(data.fee)} />
      <DetailRow label="Net Amount" value={<span className="font-bold">{formatCurrency(data.net_amount)}</span>} />
      <DetailRow label="Currency" value={data.currency?.toUpperCase()} />
      <DetailRow label="Provider" value={data.provider} />
      {data.whish_number && <DetailRow label="Whish Number" value={data.whish_number} />}
      <DetailRow label="Provider Ref" value={data.provider_ref} mono />
      {data.proof_image_url && (
        <DetailRow
          label="Receipt"
          value={
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
              Uploaded
            </span>
          }
        />
      )}
      <DetailRow label="Deposit ID" value={data.id} mono />
      <DetailRow label="Created" value={formatDate(data.created_at)} />
      {data.confirmed_at && <DetailRow label="Confirmed" value={formatDate(data.confirmed_at)} />}
    </div>
  );
}

function WithdrawalDetails({ data }: { data: WithdrawalDetail }) {
  const statusConf = STATUS_STYLES[data.status] || { color: "text-gray-700", bg: "bg-gray-100" };
  const userName = data.users?.display_name || data.users?.phone || "Unknown";

  return (
    <div className="space-y-1">
      <DetailRow label="User" value={userName} />
      <DetailRow
        label="Status"
        value={
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusConf.bg} ${statusConf.color} capitalize`}>
            {data.status}
          </span>
        }
      />
      <DetailRow label="Amount" value={<span className="text-[var(--error)]">-{formatCurrency(data.amount)}</span>} />
      <DetailRow label="Fee" value={formatCurrency(data.fee)} />
      <DetailRow label="Net Amount" value={<span className="font-bold">{formatCurrency(data.net_amount)}</span>} />
      <DetailRow label="Destination" value={data.destination} />
      {data.admin_notes && <DetailRow label="Admin Notes" value={data.admin_notes} />}
      <DetailRow label="Withdrawal ID" value={data.id} mono />
      <DetailRow label="Created" value={formatDate(data.created_at)} />
      {data.processed_at && <DetailRow label="Processed" value={formatDate(data.processed_at)} />}
    </div>
  );
}

export function TransactionDetailModal({ open, onOpenChange, data, type }: TransactionDetailModalProps) {
  if (!data) return null;

  const titles: Record<string, string> = {
    transaction: "Transaction Details",
    deposit: "Deposit Details",
    withdrawal: "Withdrawal Details",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
            {titles[type]}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {type === "transaction" && <TransactionDetails data={data as TransactionDetail} />}
          {type === "deposit" && <DepositDetails data={data as DepositDetail} />}
          {type === "withdrawal" && <WithdrawalDetails data={data as WithdrawalDetail} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
