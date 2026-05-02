"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { AGENT_VOLUME_THRESHOLDS, NGR_COMMISSION_RATES } from "@/lib/constants";
import { motion } from "framer-motion";
import type { AgentDashboardStats } from "@/types/agent";
import type { AgentLevel } from "@/types/database";

interface TierProgressProps {
  stats: AgentDashboardStats | null;
  loading: boolean;
}

const TIER_LABELS: Record<AgentLevel, string> = {
  1: "Starter",
  2: "Active",
  3: "Power",
  4: "Elite",
};

export function TierProgress({ stats, loading }: TierProgressProps) {
  if (loading) {
    return (
      <div className="bg-surface rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
        <Skeleton className="h-5 w-32 mb-4" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  if (!stats) return null;

  const level = stats.agent_level;
  const nextLevel = Math.min(level + 1, 4) as AgentLevel;
  const isMaxTier = level >= 4;

  const currentThreshold = AGENT_VOLUME_THRESHOLDS[level];
  const nextThreshold = AGENT_VOLUME_THRESHOLDS[nextLevel];
  const progress = isMaxTier
    ? 100
    : Math.min(
        ((stats.network_volume - currentThreshold) / (nextThreshold - currentThreshold)) * 100,
        100
      );

  const rates = NGR_COMMISSION_RATES[level];
  const nextRates = !isMaxTier ? NGR_COMMISSION_RATES[nextLevel] : null;

  return (
    <div className="bg-surface rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6">
      <h3 className="font-satoshi text-xs font-black text-muted-custom uppercase tracking-widest mb-4">
        Tier Progress
      </h3>

      <div className="bg-bg border border-border-custom rounded-xl p-4 space-y-4">
        {/* Tier badge + label */}
        <div className="flex items-center gap-2">
          <span className="bg-yes/10 text-yes text-[10px] font-black px-3 py-1.5 rounded-md tracking-widest uppercase border border-yes/30 font-satoshi">
            Tier {level}
          </span>
          <span className="px-2.5 py-1 bg-success/10 text-success text-[10px] font-bold rounded-full border border-success/30">
            {TIER_LABELS[level]}
          </span>
        </div>

        {/* Volume */}
        <div>
          <p className="font-satoshi text-2xl font-black text-text tabular-nums">
            {formatCurrency(stats.network_volume)}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-custom uppercase font-bold tracking-widest">
              Network Volume
            </span>
            {!isMaxTier && (
              <span className="text-xs text-muted-custom font-dm-sans tabular-nums">
                &rarr; Tier {nextLevel}{" "}
                <span className="text-text font-medium">{formatCurrency(nextThreshold)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {!isMaxTier && (
          <div className="space-y-1.5">
            <div className="w-full h-3 bg-elevated rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(progress, 2)}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="h-full bg-yes rounded-full"
                style={{ boxShadow: "0 0 12px rgba(45, 140, 255, 0.3)" }}
              />
            </div>
            <div className="flex justify-between">
              <p className="text-xs text-muted-custom tabular-nums">
                {Math.round(progress)}%
              </p>
              {nextRates && (
                <p className="text-xs text-yes font-bold">
                  Unlock {nextRates.l1}% direct rate
                </p>
              )}
            </div>
          </div>
        )}

        {/* Commission rates — mini cards */}
        <div className="grid grid-cols-2 gap-2 pt-4 border-t border-border-custom">
          <div className="bg-elevated rounded-lg p-3 border-t-2 border-t-yes">
            <p className="text-[9px] text-muted-custom uppercase font-bold tracking-wider mb-1">
              Direct
            </p>
            <p className="text-base font-black font-satoshi text-text tabular-nums">{rates.l1}%</p>
          </div>
          <div className="bg-elevated rounded-lg p-3 border-t-2 border-t-warning">
            <p className="text-[9px] text-muted-custom uppercase font-bold tracking-wider mb-1">
              Indirect
            </p>
            <p className="text-base font-black font-satoshi text-text tabular-nums">{rates.l2}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
