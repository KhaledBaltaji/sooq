"use client";

// W2 strip: profile page reduced to balance + transactions + deposit/withdraw.
// LMSR-position-aware UI was deleted; W4 cleanup will redesign as a
// speed-aware profile (active speed positions, win rate, recent trades).

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useUser } from "@/lib/auth/hooks";
import { useTransactions } from "@/hooks/use-transactions";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useWithdrawModal } from "@/components/wallet/withdraw-modal-provider";
import { formatCurrency } from "@/lib/utils";
import {
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
  Headphones,
} from "lucide-react";
import {
  getSupportWhatsAppHref,
  isSupportWhatsAppConfigured,
} from "@/lib/support-whatsapp";

export default function ProfilePage() {
  const t = useTranslations("profilePage");
  const tc = useTranslations("common");
  const tSupport = useTranslations("support");
  const { user, loading: userLoading } = useUser();
  const { openDepositModal } = useDepositModal();
  const { openWithdrawModal } = useWithdrawModal();
  const { transactions, loading: txLoading } = useTransactions(30);

  if (userLoading || !user) {
    return (
      <main className="container max-w-2xl mx-auto p-4 space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  return (
    <main className="container max-w-2xl mx-auto p-4 space-y-6">
      <header className="flex items-center gap-4">
        <Avatar
          name={user.display_name ?? "user"}
          userId={user.id}
          src={user.avatar_url}
          size="lg"
        />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {user.display_name ?? tc("guest")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatCurrency(user.balance_usd ?? 0)}
          </p>
        </div>
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={openDepositModal}
          className="flex items-center justify-center gap-2 p-4 border rounded-lg hover:bg-muted"
        >
          <ArrowDownToLine className="h-4 w-4" />
          {t("deposit")}
        </button>
        <button
          onClick={openWithdrawModal}
          className="flex items-center justify-center gap-2 p-4 border rounded-lg hover:bg-muted"
        >
          <ArrowUpFromLine className="h-4 w-4" />
          {t("withdraw")}
        </button>
      </div>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          {t("recentActivity") ?? "Recent activity"}
        </h2>
        {txLoading ? (
          <Skeleton className="h-32" />
        ) : transactions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("noActivity") ?? "No recent activity."}
          </p>
        ) : (
          <ul className="divide-y border rounded-lg">
            {transactions.slice(0, 10).map((tx) => (
              <li
                key={tx.id}
                className="px-3 py-2 flex justify-between text-sm"
              >
                <span>{tx.type}</span>
                <span className="font-mono">{formatCurrency(tx.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSupportWhatsAppConfigured() ? (
        <a
          href={getSupportWhatsAppHref(tSupport("defaultMessage"))}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Headphones className="h-4 w-4" />
          {tSupport("contact")}
        </a>
      ) : null}
    </main>
  );
}
