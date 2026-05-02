"use client";

import { useTransactions } from "@/hooks/use-transactions";
import { formatCurrency, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Transaction } from "@/types/transaction";
import {
  ArrowDownLeft, ArrowUpRight, Trophy, Percent, Gift, RotateCcw, Coins, Wallet, ArrowRightLeft
} from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof ArrowDownLeft; color: string; label: string }> = {
  deposit: { icon: ArrowDownLeft, color: "text-success", label: "Deposit" },
  withdrawal: { icon: ArrowUpRight, color: "text-error", label: "Withdrawal" },
  bet: { icon: Coins, color: "text-no", label: "Trade" },
  trade: { icon: Coins, color: "text-no", label: "Trade" },
  close_position: { icon: ArrowUpRight, color: "text-yes", label: "Cash Out" },
  win: { icon: Trophy, color: "text-success", label: "Win" },
  resolution_payout: { icon: Trophy, color: "text-success", label: "Payout" },
  resolution_fee: { icon: Percent, color: "text-muted", label: "Resolution Fee" },
  commission: { icon: Percent, color: "text-yes", label: "Commission" },
  bonus: { icon: Gift, color: "text-success", label: "Bonus" },
  refund: { icon: RotateCcw, color: "text-muted", label: "Refund" },
  seed: { icon: Coins, color: "text-muted", label: "Seed" },
  agent_transfer_out: { icon: Wallet, color: "text-warning", label: "Agent Transfer" },
  agent_transfer_in: { icon: ArrowRightLeft, color: "text-success", label: "Agent Transfer" },
};

export function TransactionList() {
  const { transactions, loading } = useTransactions();

  if (loading) {
    return (
      <div className="space-y-sm">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <p className="text-center text-muted text-sm py-lg">
        No transactions yet
      </p>
    );
  }

  return (
    <div className="space-y-xs">
      {transactions.map((tx) => {
        const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.bet;
        const Icon = config.icon;
        const isCredit = tx.amount > 0;

        return (
          <div
            key={tx.id}
            className="flex items-center justify-between px-sm py-sm hover:bg-elevated/50 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-sm">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center bg-elevated", config.color)}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-dm-sans text-text">{config.label}</p>
                <p className="text-xs text-muted">
                  {new Date(tx.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <span className={cn(
              "text-sm font-satoshi font-bold tabular-nums",
              isCredit ? "text-success" : "text-text"
            )}>
              {isCredit ? "+" : ""}{formatCurrency(Math.abs(tx.amount))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
