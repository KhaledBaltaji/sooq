"use client";

import { useBalance } from "@/hooks/use-balance";
import { formatCurrency } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function BalanceDisplay() {
  const { balance, loading } = useBalance();

  if (loading) {
    return <Skeleton className="h-14 w-40" />;
  }

  return (
    <div className="text-center">
      <p className="text-muted text-xs font-dm-sans uppercase tracking-wider">Portfolio Balance</p>
      <p className="font-satoshi text-hero font-black text-text tabular-nums mt-xs">
        {formatCurrency(balance)}
      </p>
    </div>
  );
}
