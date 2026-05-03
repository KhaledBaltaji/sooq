"use client";

// W10 profile page — speed-aware port of the prediction-market profile.
//
// Two-card top section (User info + P&L chart with range tabs), then a
// tabbed Positions / Activity section. Adapted for the slim Sooq schema:
// no LMSR shares, no agent levels, no deposit-bonus banner.
//
// Wired hooks: useUser (Auth.js session row), useSpeedPositions
// (live polling), useTransactions, useBalanceHistory, useThemeColors.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, AreaChart, Area, YAxis } from "recharts";
import {
  Settings,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  Headphones,
} from "lucide-react";
import { useUser } from "@/lib/auth/hooks";
import { useSpeedPositions } from "@/hooks/use-speed-positions";
import { useTransactions } from "@/hooks/use-transactions";
import { useBalanceHistory, type PnlRange } from "@/hooks/use-balance-history";
import { useThemeColors } from "@/hooks/use-theme-colors";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useWithdrawModal } from "@/components/wallet/withdraw-modal-provider";
import { formatCurrency, cn } from "@/lib/utils";
import {
  getSupportWhatsAppHref,
  isSupportWhatsAppConfigured,
} from "@/lib/support-whatsapp";

const RANGES: PnlRange[] = ["1D", "1W", "1M", "ALL"];

const SIDE_LABELS: Record<string, string> = {
  over: "Over",
  under: "Under",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  cashed_out: "Cashed out",
  refunded: "Refunded",
};

export default function ProfilePage() {
  const colors = useThemeColors();
  const { user, loading: userLoading } = useUser();
  const { openDepositModal } = useDepositModal();
  const { openWithdrawModal } = useWithdrawModal();
  const { positions, loading: posLoading } = useSpeedPositions();
  const { transactions, loading: txLoading } = useTransactions(30);

  const [pnlRange, setPnlRange] = useState<PnlRange>("ALL");
  const [activeTab, setActiveTab] = useState<"positions" | "activity">(
    "positions"
  );
  const [posFilter, setPosFilter] = useState<"active" | "closed">("active");

  const { data: balanceHistory, loading: chartLoading, pnlAmount } =
    useBalanceHistory(pnlRange);

  const totalStaked = useMemo(() => {
    return positions
      .filter((p) => p.status === "open")
      .reduce((sum, p) => sum + Number(p.stake ?? 0), 0);
  }, [positions]);

  const biggestWin = useMemo(() => {
    const wins = positions
      .filter((p) => p.status === "won" || p.status === "cashed_out")
      .map((p) => Number(p.payout_amount ?? 0) - Number(p.stake ?? 0))
      .filter((v) => v > 0);
    return wins.length > 0 ? Math.max(...wins) : 0;
  }, [positions]);

  const totalTrades = positions.length;
  const filteredPositions = useMemo(() => {
    if (posFilter === "active")
      return positions.filter((p) => p.status === "open");
    return positions.filter((p) => p.status !== "open");
  }, [positions, posFilter]);

  const totalBalance = (user?.balance_usd ?? 0) + totalStaked;
  const joinDate = user
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "";

  const chartColor = pnlAmount >= 0 ? colors.success : colors.no;
  const rangeLabel = pnlRange === "ALL" ? "All-time" : `Past ${pnlRange}`;

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
          Sign in to view your profile.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-yes text-white rounded-lg font-satoshi font-bold text-sm"
        >
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-4 lg:py-6 px-4 space-y-4">
      {/* ===== Top — two cards ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left: user info */}
        <div className="bg-surface rounded-2xl p-5 flex flex-col">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar
                name={user.display_name || "User"}
                userId={user.id}
                src={user.avatar_url}
                size="lg"
              />
              <div>
                <h2 className="font-satoshi font-bold text-lg text-text leading-tight">
                  {user.display_name || "User"}
                </h2>
                <p className="flex items-center gap-2 mt-0.5 text-xs text-muted-custom">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Joined {joinDate}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isSupportWhatsAppConfigured() && (
                <a
                  href={getSupportWhatsAppHref(
                    "Hi, I need help with my Sooq account."
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-xl transition-all cursor-pointer text-dim hover:text-muted-custom hover:bg-elevated"
                  title="Contact support"
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
              Portfolio value
            </p>
            <p className="font-satoshi font-black text-2xl text-text tabular-nums">
              {formatCurrency(totalBalance)}
            </p>
            <p className="text-[11px] text-muted-custom mt-0.5">
              {formatCurrency(user.balance_usd)} cash · {formatCurrency(totalStaked)} staked
            </p>
          </div>

          {/* Stats row */}
          <div className="flex items-center mb-4">
            <Stat label="Open" value={String(filteredPositions.length || 0)} />
            <Sep />
            <Stat
              label="Biggest win"
              value={biggestWin > 0 ? formatCurrency(biggestWin) : "—"}
            />
            <Sep />
            <Stat label="Total trades" value={String(totalTrades || 0)} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2.5 mt-auto">
            <button
              onClick={openDepositModal}
              className="flex-1 flex items-center justify-center gap-2 bg-yes text-white py-3 md:py-2.5 rounded-xl font-bold text-sm hover:shadow-[0_0_20px_rgba(45,140,255,0.2)] transition-all active:scale-[0.98]"
            >
              <ArrowDownToLine className="w-4 h-4" />
              Deposit
            </button>
            <button
              onClick={openWithdrawModal}
              className="flex-1 flex items-center justify-center gap-2 border border-border-custom text-text py-3 md:py-2.5 rounded-xl font-bold text-sm hover:bg-elevated transition-all active:scale-[0.98]"
            >
              <ArrowUpFromLine className="w-4 h-4" />
              Withdraw
            </button>
          </div>
        </div>

        {/* Right: P&L chart */}
        <div className="bg-surface rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: chartColor }}
              />
              <span className="text-sm font-bold text-text">Profit / loss</span>
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

          <div className="flex-1 min-h-[140px] relative">
            {chartLoading ? (
              <Skeleton className="w-full h-full rounded-xl" />
            ) : balanceHistory.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-sm text-dim">
                  Make a trade to see your P&amp;L history.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={balanceHistory}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
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
        <div className="flex items-center gap-5 border-b border-border-custom/30">
          <TabButton
            active={activeTab === "positions"}
            onClick={() => setActiveTab("positions")}
          >
            Positions
          </TabButton>
          <TabButton
            active={activeTab === "activity"}
            onClick={() => setActiveTab("activity")}
          >
            Activity
          </TabButton>
        </div>

        {activeTab === "positions" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FilterChip
                active={posFilter === "active"}
                onClick={() => setPosFilter("active")}
              >
                Active
              </FilterChip>
              <FilterChip
                active={posFilter === "closed"}
                onClick={() => setPosFilter("closed")}
              >
                Closed
              </FilterChip>
            </div>

            <div className="bg-surface rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-custom text-[11px] text-muted-custom uppercase tracking-wider font-bold">
                    <th className="px-5 py-3">Market</th>
                    <th className="px-5 py-3 hidden md:table-cell">Side</th>
                    <th className="px-5 py-3 hidden md:table-cell">Status</th>
                    <th className="px-5 py-3 text-right">Stake</th>
                    <th className="px-5 py-3 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {posLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6">
                        <Skeleton className="h-12 rounded" />
                      </td>
                    </tr>
                  ) : filteredPositions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-10 text-center text-muted-custom text-sm"
                      >
                        No {posFilter} positions.
                      </td>
                    </tr>
                  ) : (
                    filteredPositions.map((p) => {
                      const m = p.market;
                      const label = m
                        ? `${m.asset} ${m.duration}`
                        : "Speed market";
                      const href = m ? `/speed/${m.id}` : null;
                      const titleNode = href ? (
                        <Link
                          href={href}
                          className="text-text hover:text-yes font-medium"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="text-text">{label}</span>
                      );
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-border-custom/30 last:border-b-0"
                        >
                          <td className="px-5 py-3">{titleNode}</td>
                          <td className="px-5 py-3 hidden md:table-cell">
                            <span
                              className={cn(
                                "inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                                p.side === "over"
                                  ? "bg-success/10 text-success"
                                  : "bg-no/10 text-no"
                              )}
                            >
                              {SIDE_LABELS[p.side] ?? p.side}
                            </span>
                          </td>
                          <td className="px-5 py-3 hidden md:table-cell text-muted-custom text-xs">
                            {STATUS_LABELS[p.status] ?? p.status}
                          </td>
                          <td className="px-5 py-3 text-right font-mono">
                            {formatCurrency(Number(p.stake ?? 0))}
                          </td>
                          <td className="px-5 py-3 text-right font-mono">
                            {p.payout_amount != null
                              ? formatCurrency(Number(p.payout_amount))
                              : "—"}
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

        {activeTab === "activity" && (
          <div className="bg-surface rounded-2xl overflow-hidden">
            {txLoading ? (
              <div className="px-5 py-6">
                <Skeleton className="h-24 rounded" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="px-5 py-12 text-center text-muted-custom text-sm">
                No activity yet — your trades and transactions will appear here.
              </div>
            ) : (
              <ul className="divide-y divide-border-custom/30">
                {transactions.map((tx) => (
                  <li
                    key={tx.id}
                    className="px-5 py-3 flex items-center justify-between text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="text-text capitalize">
                        {String(tx.type).replace(/_/g, " ")}
                      </span>
                      {tx.description && (
                        <span className="text-xs text-muted-custom">
                          {tx.description}
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        Number(tx.amount) > 0
                          ? "text-success"
                          : Number(tx.amount) < 0
                            ? "text-no"
                            : "text-text"
                      )}
                    >
                      {Number(tx.amount) > 0 ? "+" : ""}
                      {formatCurrency(Number(tx.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1">
      <p className="text-[11px] text-muted-custom font-bold uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="font-satoshi font-bold text-lg text-text tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Sep() {
  return <div className="w-px h-8 bg-border-custom mx-3" />;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-sm font-bold pb-3 border-b-2 transition-colors cursor-pointer -mb-px min-h-11 md:min-h-0 flex items-center",
        active
          ? "text-text border-text"
          : "text-muted-custom border-transparent hover:text-text"
      )}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer min-h-11 md:min-h-0",
        active ? "bg-elevated text-text" : "text-muted-custom hover:text-text"
      )}
    >
      {children}
    </button>
  );
}
