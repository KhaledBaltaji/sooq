"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/lib/auth/hooks";
import { usePositions } from "@/hooks/use-positions";
import { useTransactions } from "@/hooks/use-transactions";
import { useBalanceHistory, type PnlRange } from "@/hooks/use-balance-history";
import { useThemeColors } from "@/hooks/use-theme-colors";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useWithdrawModal } from "@/components/wallet/withdraw-modal-provider";
import { DepositBonusBanner } from "@/components/wallet/deposit-bonus-banner";
import { formatCurrency, cn } from "@/lib/utils";
import { formatPrice } from "@/lib/market-utils";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  YAxis,
} from "recharts";
import {
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  Shield,
  Headphones,
} from "lucide-react";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

const RANGES: PnlRange[] = ["1D", "1W", "1M", "ALL"];

export default function ProfilePage() {
  const locale = useLocale();
  const t = useTranslations("profilePage");
  const tc = useTranslations("common");
  const colors = useThemeColors();
  const { user, loading: userLoading } = useUser();
  const { openDepositModal } = useDepositModal();
  const { openWithdrawModal } = useWithdrawModal();
  const tSupport = useTranslations("support");
  const { positions, stats, loading: posLoading } = usePositions();
  const { transactions, loading: txLoading } = useTransactions(30);

  const [pnlRange, setPnlRange] = useState<PnlRange>("ALL");
  const [activeTab, setActiveTab] = useState<"positions" | "activity">("positions");
  const [posFilter, setPosFilter] = useState<"active" | "closed">("active");

  const { data: balanceHistory, loading: chartLoading, pnlAmount, pnlPercent } =
    useBalanceHistory(pnlRange);

  // Computed stats
  const positionsValue = useMemo(() => {
    return positions.reduce((sum, p) => {
      const price =
        p.side === "yes"
          ? p.amm_state?.current_yes_price
          : p.amm_state?.current_no_price;
      return sum + p.shares_held * (price || 0);
    }, 0);
  }, [positions]);

  const biggestWin = useMemo(() => {
    const wins = positions.map((p) => p.realized_pnl).filter((v) => v > 0);
    return wins.length > 0 ? Math.max(...wins) : 0;
  }, [positions]);

  const totalBalance = (user?.balance_usd ?? 0) + positionsValue;

  const joinDate = user
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "";

  const chartColor = pnlAmount >= 0 ? colors.success : colors.no;
  const rangeLabel = pnlRange === "ALL" ? t("allTime") : t("past", { range: pnlRange });

  if (userLoading) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <Skeleton className="h-10 rounded-xl w-48" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="px-4 py-16 text-center space-y-4">
        <p className="text-muted-custom text-sm">
          {t("signInToView")}
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-yes text-white rounded-lg font-satoshi font-bold text-sm"
        >
          {t("goHome")}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-4 lg:py-6 px-4 space-y-4">
      {/* ===== Two-Card Top Section ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left Card: User Info */}
        <div className="bg-surface rounded-2xl p-5 flex flex-col">
          {/* User header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={user.display_name || "User"} userId={user.id} src={user.avatar_url} size="lg" />
              <div>
                <h2 className="font-satoshi font-bold text-lg text-text leading-tight">
                  {user.display_name || tc("user")}
                </h2>
                <p className="flex items-center gap-2 mt-0.5 text-xs text-muted-custom">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {t("joined", { date: joinDate })}
                  </span>
                  <span className="text-dim">·</span>
                  <span className="flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    {t("level", { level: user.agent_level })}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isSupportWhatsAppConfigured() && (
                <a
                  href={getSupportWhatsAppHref(tSupport("whatsAppDefaultMessage"))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-xl transition-all cursor-pointer text-dim hover:text-muted-custom hover:bg-elevated"
                  title={tSupport("contactWhatsApp")}
                >
                  <Headphones className="w-4 h-4" />
                </a>
              )}
              <Link
                href="/settings"
                className="p-2 rounded-xl transition-all cursor-pointer text-dim hover:text-muted-custom hover:bg-elevated"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Portfolio value hero */}
          <div className="mt-4 mb-3">
            <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-0.5">
              {t("portfolioValue")}
            </p>
            <p className="font-satoshi font-black text-2xl text-text tabular-nums">
              {formatCurrency(totalBalance)}
            </p>
          </div>

          {/* Stats row */}
          <div className="flex items-center mb-4">
            <div className="flex-1">
              <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-0.5">
                {t("positions")}
              </p>
              <p className="font-satoshi font-bold text-lg text-text tabular-nums">
                {formatCurrency(positionsValue)}
              </p>
            </div>
            <div className="w-px h-8 bg-border-custom mx-3" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-0.5">
                {t("biggestWin")}
              </p>
              <p className="font-satoshi font-bold text-lg text-text tabular-nums">
                {biggestWin > 0 ? formatCurrency(biggestWin) : "\u2014"}
              </p>
            </div>
            <div className="w-px h-8 bg-border-custom mx-3" />
            <div className="flex-1">
              <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-0.5">
                {t("marketsLabel")}
              </p>
              <p className="font-satoshi font-bold text-lg text-text tabular-nums">
                {positions.length || 0}
              </p>
            </div>
          </div>

          {/* Deposit bonus banner — shows for organic users with a $20+ confirmed
               deposit who haven't claimed yet. Auto-hides otherwise. */}
          <DepositBonusBanner className="mb-3" />

          {/* Action buttons */}
          <div className="flex gap-2.5 mt-auto">
            <button
              onClick={openDepositModal}
              className="flex-1 flex items-center justify-center gap-2 bg-yes text-white py-3 md:py-2.5 rounded-xl font-bold text-sm hover:shadow-[0_0_20px_rgba(45,140,255,0.2)] transition-all active:scale-[0.98]"
            >
              <ArrowDownToLine className="w-4 h-4" />
              {tc("deposit")}
            </button>
            <button
              onClick={openWithdrawModal}
              className="flex-1 flex items-center justify-center gap-2 border border-border-custom text-text py-3 md:py-2.5 rounded-xl font-bold text-sm hover:bg-elevated transition-all active:scale-[0.98]"
            >
              <ArrowUpFromLine className="w-4 h-4" />
              {tc("withdraw")}
            </button>
          </div>
        </div>

        {/* Right Card: P&L Chart */}
        <div className="bg-surface rounded-2xl p-5 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: chartColor }}
              />
              <span className="text-sm font-bold text-text">{t("profitLoss")}</span>
            </div>
            <div className="flex items-center gap-3">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setPnlRange(r)}
                  className={cn(
                    "text-xs font-bold transition-colors cursor-pointer min-h-11 md:min-h-0 flex items-center",
                    pnlRange === r
                      ? "text-text"
                      : "text-dim hover:text-muted-custom"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* P&L value */}
          <h2
            className={cn(
              "font-satoshi font-black text-2xl tabular-nums mt-1",
              pnlAmount >= 0 ? "text-success" : "text-no"
            )}
          >
            {pnlAmount >= 0 ? "+" : ""}
            {formatCurrency(Math.abs(pnlAmount))}
          </h2>
          <span className="text-[11px] text-muted-custom mb-1">{rangeLabel}</span>

          {/* Chart */}
          <div className="flex-1 min-h-[100px] relative">
            {chartLoading ? (
              <Skeleton className="w-full h-full rounded-xl" />
            ) : balanceHistory.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-sm text-dim">
                  {t("tradeToSeePnl")}
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={balanceHistory}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="balanceFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={chartColor}
                        stopOpacity={0.15}
                      />
                      <stop
                        offset="100%"
                        stopColor={chartColor}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#balanceFill)"
                    isAnimationActive={true}
                    animationDuration={400}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ===== Tabs: Positions | Activity ===== */}
      <div className="space-y-3">
        {/* Tab bar */}
        <div className="flex items-center gap-5 border-b border-border-custom/30">
          <button
            onClick={() => setActiveTab("positions")}
            className={cn(
              "text-sm font-bold pb-3 border-b-2 transition-colors cursor-pointer -mb-px min-h-11 md:min-h-0 flex items-center",
              activeTab === "positions"
                ? "text-text border-text"
                : "text-muted-custom border-transparent hover:text-text"
            )}
          >
            {t("positionsTab")}
          </button>
          <button
            onClick={() => setActiveTab("activity")}
            className={cn(
              "text-sm font-bold pb-3 border-b-2 transition-colors cursor-pointer -mb-px min-h-11 md:min-h-0 flex items-center",
              activeTab === "activity"
                ? "text-text border-text"
                : "text-muted-custom border-transparent hover:text-text"
            )}
          >
            {t("activityTab")}
          </button>
        </div>

        {/* ===== Positions Tab ===== */}
        {activeTab === "positions" && (
          <div className="space-y-3">
            {/* Sub-filters */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPosFilter("active")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer min-h-11 md:min-h-0",
                  posFilter === "active"
                    ? "bg-elevated text-text"
                    : "text-muted-custom hover:text-text"
                )}
              >
                {t("active")}
              </button>
              <button
                onClick={() => setPosFilter("closed")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer min-h-11 md:min-h-0",
                  posFilter === "closed"
                    ? "bg-elevated text-text"
                    : "text-muted-custom hover:text-text"
                )}
              >
                {t("closed")}
              </button>
            </div>

            {/* Positions table */}
            <div className="bg-surface rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-custom text-[11px] text-muted-custom uppercase tracking-wider font-bold">
                    <th className="px-5 py-3">{t("marketCol")}</th>
                    <th className="px-5 py-3 hidden md:table-cell">{t("avgCol")}</th>
                    <th className="px-5 py-3 hidden md:table-cell">{t("currentCol")}</th>
                    <th className="px-5 py-3 text-right">{t("valueCol")}</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {posLoading ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-6">
                        <Skeleton className="h-12 rounded" />
                      </td>
                    </tr>
                  ) : posFilter === "closed" ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-5 py-10 text-center text-muted-custom text-sm"
                      >
                        {t("noClosedPositions")}
                      </td>
                    </tr>
                  ) : positions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-5 py-10 text-center text-muted-custom text-sm"
                      >
                        {t("noPositionsFound")}
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos, i) => {
                      const question =
                        locale === "ar"
                          ? pos.market?.question_ar
                          : pos.market?.question_en;
                      const currentPrice =
                        pos.side === "yes"
                          ? pos.amm_state?.current_yes_price ?? 0
                          : pos.amm_state?.current_no_price ?? 0;
                      const currentValue = pos.shares_held * currentPrice;

                      return (
                        <tr
                          key={pos.id}
                          className={cn(
                            "hover:bg-elevated transition-colors",
                            i < positions.length - 1 &&
                              "border-b border-border-custom/30"
                          )}
                        >
                          <td className="px-5 py-3.5">
                            <Link
                              href={`/market/${pos.market_id}`}
                              className="flex items-center gap-3"
                            >
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-black uppercase shrink-0",
                                  pos.side === "yes"
                                    ? "bg-success/10 text-success"
                                    : "bg-no/10 text-no"
                                )}
                              >
                                {pos.side === "yes" ? "Y" : "N"}
                              </span>
                              <span className="font-bold text-text line-clamp-1">
                                {question}
                              </span>
                            </Link>
                          </td>
                          <td className="px-5 py-3.5 hidden md:table-cell">
                            <span className="text-muted-custom tabular-nums">
                              {formatPrice(pos.avg_entry_price, "neutral")}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 hidden md:table-cell">
                            <span className="text-text font-bold tabular-nums">
                              {formatPrice(currentPrice, "sell")}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <span className="text-text font-bold tabular-nums">
                              {formatCurrency(currentValue)}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== Activity Tab ===== */}
        {activeTab === "activity" && (
          <div className="bg-surface rounded-2xl overflow-hidden">
            {txLoading ? (
              <div className="px-5 py-6">
                <Skeleton className="h-12 rounded" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-custom">{t("noActivityYet")}</p>
                <p className="text-xs text-dim mt-1">
                  {t("tradesWillAppear")}
                </p>
              </div>
            ) : (
              transactions.map((tx, i) => (
                <div
                  key={tx.id}
                  className={cn(
                    "flex items-center justify-between px-5 py-3.5",
                    i < transactions.length - 1 &&
                      "border-b border-border-custom/30"
                  )}
                >
                  <div>
                    <p className="text-sm font-bold text-text capitalize">
                      {tx.description || tx.type.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-custom mt-0.5">
                      {new Date(tx.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "font-bold tabular-nums text-sm",
                      tx.amount >= 0 ? "text-success" : "text-no"
                    )}
                  >
                    {tx.amount >= 0 ? "+" : ""}
                    {formatCurrency(Math.abs(tx.amount))}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
