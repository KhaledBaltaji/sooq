"use client";

import { formatCurrency } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Clock, TrendingUp, Users } from "lucide-react";
import { motion } from "framer-motion";
import type { AgentDashboardStats } from "@/types/agent";

interface AgentStatsGridProps {
  stats: AgentDashboardStats | null;
  loading: boolean;
}

const cards = [
  { key: "total_credited", label: "Total Earnings", icon: DollarSign, color: "text-success", accent: "border-s-success", iconBg: "bg-success/10", tooltip: "All-time commissions credited to your balance" },
  { key: "total_pending", label: "Pending", icon: Clock, color: "text-warning", accent: "border-s-warning", iconBg: "bg-warning/10", tooltip: "Commissions earned but not yet credited" },
  { key: "this_month_credited", label: "This Month", icon: TrendingUp, color: "text-yes", accent: "border-s-yes", iconBg: "bg-yes/10", tooltip: "Commissions earned this calendar month" },
  { key: "network_size", label: "Network Size", icon: Users, color: "text-text", accent: "border-s-border-custom", iconBg: "bg-elevated", tooltip: "Total users in your referral network across all layers" },
] as const;

export function AgentStatsGrid({ stats, loading }: AgentStatsGridProps) {
  if (loading) {
    return (
      <div className="bg-surface rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
        <Skeleton className="h-5 w-32 mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {cards.map((c) => (
            <Skeleton key={c.key} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="bg-surface rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
      <h3 className="font-satoshi text-xs font-black text-muted-custom uppercase tracking-widest mb-4">
        Agent Stats
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c, i) => {
          const value = stats[c.key];
          const display = c.key === "network_size"
            ? value.toLocaleString()
            : formatCurrency(value);

          return (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
              className={`bg-bg border border-border-custom border-s-2 ${c.accent} rounded-lg p-4 relative group overflow-hidden`}
            >
              <div className={`w-7 h-7 ${c.iconBg} rounded-lg flex items-center justify-center absolute top-3.5 right-3.5`}>
                <c.icon className={`w-3.5 h-3.5 ${c.color} opacity-70`} />
              </div>
              <p className="text-[10px] text-muted-custom uppercase font-bold tracking-widest mb-1">
                {c.label}
              </p>
              <p className={`font-satoshi text-xl font-black tabular-nums ${c.color}`}>
                {display}
              </p>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-elevated border border-border-custom rounded-lg text-xs text-text font-dm-sans opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                {c.tooltip}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
