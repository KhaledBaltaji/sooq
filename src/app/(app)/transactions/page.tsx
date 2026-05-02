"use client";

import { useState } from "react";
import Link from "next/link";
import { useTransactions } from "@/hooks/use-transactions";
import { useSession } from "@/lib/auth/hooks";
import { SignInPrompt } from "@/components/auth/sign-in-prompt";
import { formatCurrency, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Trophy,
  Percent,
  Gift,
  RotateCcw,
  Coins,
  Wallet,
  ArrowRightLeft,
  History,
} from "lucide-react";

// W2/W3 strip: dropped LMSR/branch/commission/bonus transaction kinds
// (trade/bet/close_position/win/resolution_*/commission/bonus/seed/
// agent_transfer_*). Slim list maps Sooq Speed transaction types only.
const TYPE_CONFIG: Record<string, { icon: typeof ArrowDownLeft; color: string; label: string }> = {
  deposit:        { icon: ArrowDownLeft,   color: "text-success",     label: "Deposit" },
  withdrawal:     { icon: ArrowUpRight,    color: "text-error",       label: "Withdrawal" },
  speed_stake:    { icon: Coins,           color: "text-no",          label: "Speed Stake" },
  speed_cashout:  { icon: ArrowUpRight,    color: "text-yes",         label: "Cash Out" },
  speed_payout:   { icon: Trophy,          color: "text-success",     label: "Payout" },
  speed_refund:   { icon: RotateCcw,       color: "text-muted-custom", label: "Refund" },
  admin_credit:   { icon: ArrowDownLeft,   color: "text-success",     label: "Admin Credit" },
  admin_debit:    { icon: ArrowUpRight,    color: "text-error",       label: "Admin Debit" },
};

type Filter = "all" | "trades" | "deposits";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "trades",   label: "Trades" },
  { key: "deposits", label: "Deposits" },
];

const FILTER_TYPES: Record<Filter, string[] | null> = {
  all: null,
  trades: ["speed_stake", "speed_cashout", "speed_payout", "speed_refund"],
  deposits: ["deposit", "withdrawal"],
};

export default function TransactionsPage() {
  const { user, loading: authLoading } = useSession();
  const { transactions, loading } = useTransactions(100);
  const [filter, setFilter] = useState<Filter>("all");

  // Anonymous — prevent any REST/realtime fetch and show sign-in prompt
  if (!authLoading && !user) {
    return (
      <SignInPrompt
        icon={History}
        title="Sign in to view your transactions"
        description="Track your deposits, trades, commissions, and withdrawals in one place."
      />
    );
  }

  const filtered = FILTER_TYPES[filter]
    ? transactions.filter((tx) => FILTER_TYPES[filter]!.includes(tx.type))
    : transactions;

  // Group by date
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, tx) => {
    const date = new Date(tx.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(tx);
    return acc;
  }, {});

  return (
    <div className="max-w-lg mx-auto pt-4 pb-24 px-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/trade"
          className="p-2 -ml-2 rounded-xl text-muted-custom hover:text-text hover:bg-elevated transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-satoshi font-bold text-text">Transactions</h1>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer",
              filter === f.key
                ? "bg-elevated text-text"
                : "text-muted-custom hover:text-text"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-muted-custom">No transactions found</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([date, txs]) => (
            <div key={date}>
              <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-2">
                {date}
              </p>
              <div className="bg-surface rounded-2xl overflow-hidden">
                {txs.map((tx, i) => {
                  const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.speed_stake;
                  const Icon = config.icon;
                  const isCredit = tx.amount > 0;
                  const isTrade =
                    tx.type === "speed_stake" ||
                    tx.type === "speed_cashout" ||
                    tx.type === "speed_payout" ||
                    tx.type === "speed_refund";
                  const desc = (tx.description || "").toLowerCase();
                  const isYes = desc.includes("yes");
                  const isNo = desc.includes("no");

                  return (
                    <div
                      key={tx.id}
                      className={cn(
                        "flex items-center justify-between px-4 py-3.5",
                        i < txs.length - 1 && "border-b border-border-custom/30"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {isTrade && (isYes || isNo) ? (
                          <div className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center",
                            isYes ? "bg-yes/10" : "bg-no/10"
                          )}>
                            <span className={cn(
                              "text-xs font-black uppercase",
                              isYes ? "text-yes" : "text-no"
                            )}>
                              {isYes ? "Y" : "N"}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              "w-9 h-9 rounded-full flex items-center justify-center bg-elevated",
                              config.color
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-bold text-text">
                            {tx.description || config.label}
                          </p>
                          <p className="text-[11px] text-muted-custom mt-0.5">
                            {new Date(tx.created_at).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          isCredit ? "text-success" : "text-text"
                        )}
                      >
                        {isCredit ? "+" : ""}
                        {formatCurrency(Math.abs(tx.amount))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
