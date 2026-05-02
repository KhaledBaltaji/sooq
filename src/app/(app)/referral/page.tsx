"use client";

import { useState } from "react";
import { useUser } from "@/lib/auth/hooks";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Odometer } from "@/components/ui/odometer";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, Zap, ChevronDown, Gift, Users, UserPlus, DollarSign, Share2, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useAgentStats, useAgentNetwork, useAgentWalletSummary } from "@/hooks/use-agent-dashboard";
import { AGENT_VOLUME_THRESHOLDS, AGENT_ACTIVATION_THRESHOLD, NGR_COMMISSION_RATES } from "@/lib/constants";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { NetworkTree } from "@/components/agent/network-tree";
import { CommissionFeed } from "@/components/agent/commission-feed";
import { AgentStatsGrid } from "@/components/agent/agent-stats-grid";
import { TierProgress } from "@/components/agent/tier-progress";
import { AgentWalletCard } from "@/components/agent/agent-wallet-card";
import { ActivationProgressCard } from "@/components/agent/activation-overlay";
import type { AgentLevel } from "@/types/database";

const FAQ_ITEMS = [
  { q: "How do I earn agent rewards?", a: "You earn commissions when people you invite sign up and trade on Sooq. Your rate depends on your agent tier and their trading volume." },
  { q: "When are payouts processed?", a: "Trade commissions are credited in real-time to your Agent Wallet. Resolution commissions are paid when markets resolve." },
  { q: "How do I use my earnings?", a: "Transfer funds from your Agent Wallet to your Portfolio to trade or withdraw. Transfers are instant with no minimum." },
  { q: "Is there a limit to how many people I can invite?", a: "No limit. The more people you invite, the higher your agent tier — unlocking better commission rates." },
  { q: 'What is the "Boosted" status?', a: "Boosted means your account qualifies for enhanced commission rates based on your network's trading volume." },
];

const TABS = [
  { key: "activity", label: "Network" },
  { key: "campaigns", label: "Campaigns" },
  { key: "payouts", label: "Payouts" },
] as const;

export default function ReferralPage() {
  const { user, loading } = useUser();
  const { stats, loading: statsLoading, refetch: refetchStats } = useAgentStats(user?.id);
  const { summary: walletSummary, refetch: refetchWallet } = useAgentWalletSummary(user?.id);
  const { tree, loading: treeLoading } = useAgentNetwork(user?.id);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "campaigns" | "payouts">("activity");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { openLoginModal } = useAuthModal();

  if (loading || statsLoading) {
    return (
      <div className="pt-8 pb-xl max-w-[1200px] mx-auto px-md">
        <Skeleton className="h-48 rounded-xl mb-4" />
        <Skeleton className="h-14 rounded-xl mb-6" />
        <Skeleton className="h-10 w-64 rounded-xl mb-8" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!user) {
    const rates = NGR_COMMISSION_RATES[1];
    return (
      <div className="px-4 lg:px-md pt-8 pb-24 max-w-[1200px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ─── Left Column: Info ─── */}
          <div className="lg:col-span-3 space-y-4">
            {/* Hero Card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="bg-surface rounded-xl overflow-hidden"
            >
              <div className="relative h-52 lg:h-56 bg-gradient-to-br from-yes/25 via-yes/8 to-surface overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
                <div className="absolute inset-0 grid-dots opacity-40" />
                <div className="absolute inset-x-0 bottom-0 p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-yes" />
                    <span className="text-[10px] text-yes uppercase font-black tracking-widest font-satoshi">Agent Program</span>
                  </div>
                  <h1 className="text-2xl lg:text-4xl font-satoshi font-black tracking-tight text-text leading-tight">
                    Earn from every trade.
                  </h1>
                  <p className="text-sm text-muted-custom mt-2 font-dm-sans max-w-md">
                    Invite friends to Sooq. When they trade, you earn a cut — automatically, forever.
                  </p>
                </div>
              </div>
              {/* Commission rates */}
              <div className="px-6 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-yes/10 rounded-lg p-4 text-center">
                    <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-1">Direct</p>
                    <p className="font-satoshi font-black text-2xl text-yes tabular-nums">{rates.l1}%</p>
                  </div>
                  <div className="bg-elevated rounded-lg p-4 text-center">
                    <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-1">Indirect</p>
                    <p className="font-satoshi font-black text-2xl text-text tabular-nums">{rates.l2}%</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* CTA — mobile only */}
            <div className="lg:hidden">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="bg-surface rounded-xl p-5"
              >
                <h3 className="text-lg font-satoshi font-black text-text mb-2">Start earning today</h3>
                <p className="text-sm text-muted-custom font-dm-sans mb-4">
                  Create your free account and get your unique referral link in seconds.
                </p>
                <button
                  onClick={openLoginModal}
                  className="w-full h-[52px] bg-yes text-white text-base font-satoshi font-black rounded-lg flex items-center justify-center gap-2 transition-all duration-[80ms] cursor-pointer shadow-[0_4px_0_0px_rgba(30,100,200,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(30,100,200,0.9)] hover:brightness-110"
                >
                  <TrendingUp className="w-5 h-5" /> Sign Up to Start Earning
                </button>
              </motion.div>
            </div>

            {/* How It Works */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="bg-surface rounded-xl overflow-hidden"
            >
              <div className="p-5 lg:p-6">
                <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-4">How it works</p>
                <div className="space-y-2">
                  {[
                    { step: "01", text: "Send your link to friends", icon: Share2, color: "text-yes", bg: "bg-yes/10" },
                    { step: "02", text: "They sign up and place a trade", icon: UserPlus, color: "text-success", bg: "bg-success/10" },
                    { step: "03", text: "You earn cash from every trade they make", icon: DollarSign, color: "text-warning", bg: "bg-warning/10" },
                  ].map(({ step, text, icon: Icon, color, bg }, i) => (
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.25 + i * 0.08 }}
                      className="flex items-center gap-3 p-3 bg-bg rounded-lg"
                    >
                      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`w-4 h-4 ${color}`} />
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] font-mono font-bold text-muted-custom tabular-nums">{step}</span>
                        <p className="text-sm text-text font-dm-sans">{text}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Earning Potential */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              className="bg-surface rounded-xl overflow-hidden"
            >
              <div className="p-5 lg:p-6">
                <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-3">Earning Potential</p>
                <p className="text-sm text-muted-custom mb-3 font-dm-sans">
                  If <span className="text-text font-bold">10 friends</span> each trade{" "}
                  <span className="text-text font-bold">$100/day</span>
                </p>
                <div className="flex items-baseline gap-2">
                  <p
                    className="text-2xl font-satoshi font-black text-success"
                    style={{ textShadow: "0 0 20px rgba(0, 232, 123, 0.2)" }}
                  >
                    ~${Math.round(10 * 100 * 30 * 0.05 * (rates.l1 / 100))}/mo
                  </p>
                  <span className="text-xs text-muted-custom">from direct commissions alone</span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ─── Right Column: CTA — desktop only ─── */}
          <div className="hidden lg:block lg:col-span-2 space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-surface rounded-xl p-6 sticky top-24"
            >
              <h3 className="text-lg font-satoshi font-black text-text mb-2">Start earning today</h3>
              <p className="text-sm text-muted-custom font-dm-sans mb-5">
                Create your free account and get your unique referral link in seconds.
              </p>
              <button
                onClick={openLoginModal}
                className="w-full h-[52px] bg-yes text-white text-base font-satoshi font-black rounded-lg flex items-center justify-center gap-2 transition-all duration-[80ms] cursor-pointer shadow-[0_4px_0_0px_rgba(30,100,200,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(30,100,200,0.9)] hover:brightness-110"
              >
                <TrendingUp className="w-5 h-5" /> Sign Up to Start Earning
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  const referralLink = typeof window !== "undefined"
    ? `${window.location.origin}?ref=${user.referral_code}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      console.error("Failed to copy to clipboard");
    }
  };

  const shareWhatsApp = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Join me on Sooq! ${referralLink}`)}`,
      "_blank"
    );
  };

  const volume = stats?.network_volume ?? (user.network_volume ?? 0);
  const level = stats?.agent_level ?? user.agent_level;
  const nextLevel = Math.min(level + 1, 4) as AgentLevel;
  const nextThreshold = AGENT_VOLUME_THRESHOLDS[nextLevel];
  const isMaxTier = level >= 4;
  const volumeTarget = isMaxTier ? volume : nextThreshold;
  const progress = isMaxTier
    ? 100
    : Math.min((volume / volumeTarget) * 100, 100);

  const isActivated = stats?.agent_activated ?? false;
  const qualifiedCount = stats?.qualified_referral_count ?? 0;
  const totalEscrowed = stats?.total_escrowed ?? 0;
  const remainingToActivate = Math.max(AGENT_ACTIVATION_THRESHOLD - qualifiedCount, 0);

  return (
    <div className="pt-8 pb-xl max-w-[1200px] mx-auto px-md">

      {/* ─── Activation banner — shown until 5 qualified referrals ─── */}
      {!isActivated && (
        <div className="mb-4">
          <ActivationProgressCard
            qualifiedCount={qualifiedCount}
            remaining={remainingToActivate}
            totalEscrowed={totalEscrowed}
            delay={0}
          />
        </div>
      )}

      {/* ─── Hero Banner — full-width gradient ─── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl overflow-hidden mb-4"
      >
        {/* Gradient hero area */}
        <div className="relative bg-gradient-to-br from-yes/20 via-yes/8 to-surface rounded-xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-surface/80 via-transparent to-transparent" />
          <div className="absolute inset-0 grid-dots opacity-30" />

          <div className="relative px-6 pt-8 pb-6">
            {/* Title row */}
            <div className="flex items-center gap-3 mb-6">
              <Zap className="w-5 h-5 text-yes" />
              <h1 className="text-3xl lg:text-4xl font-satoshi font-black tracking-tight text-text">
                Referrals
              </h1>
              {level >= 2 && (
                <span className="bg-success/10 text-success text-[10px] font-black px-2.5 py-1 rounded tracking-widest uppercase border border-success/30 font-satoshi">
                  Boosted
                </span>
              )}
            </div>

            {/* Stat cards row */}
            <div className="grid grid-cols-3 gap-3 lg:gap-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <UserPlus className="w-3.5 h-3.5 text-muted-custom" />
                  <p className="text-[10px] text-muted-custom uppercase font-bold tracking-wider whitespace-nowrap">Sign ups</p>
                </div>
                <p className="font-satoshi text-2xl font-black text-text tabular-nums">{user.direct_referral_count}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-muted-custom" />
                  <p className="text-[10px] text-muted-custom uppercase font-bold tracking-wider whitespace-nowrap">Active Traders</p>
                </div>
                <p className="font-satoshi text-2xl font-black text-text tabular-nums">{stats?.network_size ?? 0}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-success" />
                  <p className="text-[10px] text-muted-custom uppercase font-bold tracking-wider whitespace-nowrap">Earnings</p>
                </div>
                <div style={{ textShadow: "0 0 16px rgba(0, 232, 123, 0.2)" }}>
                  <Odometer
                    value={stats?.total_credited ?? 0}
                    className="text-2xl font-black text-success"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Volume progress — inside hero */}
          {!isMaxTier && (
            <div className="relative px-6 pb-5">
              <div className="flex justify-between items-center mb-2">
                <p className="text-[10px] text-muted-custom uppercase font-bold tracking-widest">Volume to Tier {nextLevel}</p>
                <Odometer value={volume} className="text-sm font-bold text-yes" />
              </div>
              <div className="h-2.5 w-full bg-black/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yes rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(progress, 2)}%`,
                    boxShadow: "0 0 12px rgba(45, 140, 255, 0.3)",
                  }}
                />
              </div>
              <p className="text-muted-custom text-xs font-dm-sans mt-1.5">
                {formatCurrency(Math.max(0, volumeTarget - volume))} more to unlock{" "}
                <span className="text-yes font-bold">Tier {nextLevel}</span>
                <span className="float-end text-muted-custom tabular-nums">{formatCurrency(volumeTarget)}</span>
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* ─── Wallet Card — separate section ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="bg-surface rounded-xl p-5 mb-4"
      >
        <AgentWalletCard
          agentBalance={stats?.agent_balance_usd ?? user.agent_balance_usd ?? 0}
          available={walletSummary?.available}
          pending={walletSummary?.pending}
          nextUnlockAt={walletSummary?.next_unlock_at}
          loading={statsLoading}
          onTransferComplete={() => {
            refetchStats();
            refetchWallet();
          }}
        />
      </motion.div>

      {/* ─── Compact Referral Link Row ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex items-center gap-2 mb-6"
      >
        <div className="flex-1 px-3 py-2.5 bg-surface border border-border-custom rounded-lg overflow-hidden">
          <code className="text-xs text-muted-custom font-mono truncate block">
            {referralLink || "sooq.exchange?ref=..."}
          </code>
        </div>
        <button
          onClick={copyLink}
          className="w-10 h-10 bg-surface border border-border-custom rounded-lg flex items-center justify-center shrink-0 hover:border-yes/40 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-muted-custom" />}
        </button>
        <button
          onClick={shareWhatsApp}
          className="h-10 px-4 bg-success text-white text-xs font-satoshi font-black rounded-lg flex items-center gap-1.5 shrink-0 transition-all duration-[80ms] shadow-[0_3px_0_0px_rgba(0,140,70,0.9)] active:translate-y-[2px] active:shadow-[0_1px_0_0px_rgba(0,140,70,0.9)] hover:brightness-110"
        >
          <Image src="/icons/Untitled design (1).png" alt="WhatsApp" width={14} height={14} /> WhatsApp
        </button>
      </motion.div>

      {/* ─── Pill Tab Bar ─── */}
      <div className="bg-surface rounded-xl p-1 flex gap-1 mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "relative px-4 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap flex-1 text-center",
              activeTab === tab.key
                ? "text-text"
                : "text-muted-custom hover:text-text"
            )}
          >
            {activeTab === tab.key && (
              <motion.div
                layoutId="agent-tab-bg"
                className="absolute inset-0 bg-elevated rounded-lg"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ─── Tab Content ─── */}
      <AnimatePresence mode="wait">
        {activeTab === "activity" && (
          <motion.div
            key="activity"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start"
          >
            {/* Network Tree — 60% */}
            <div className="lg:col-span-3">
              <p className="text-[10px] text-muted-custom uppercase font-bold tracking-widest mb-4">Network</p>
              {treeLoading ? (
                <div className="bg-surface rounded-xl overflow-hidden p-6">
                  <Skeleton className="h-64" />
                </div>
              ) : tree.length === 0 ? (
                <div className="bg-surface rounded-xl overflow-hidden p-8 min-h-[280px] relative">
                  <div className="grid-dots absolute inset-0 opacity-20 pointer-events-none" />
                  <div className="relative">
                    <div className="w-12 h-12 bg-elevated rounded-xl flex items-center justify-center mb-4">
                      <Users className="w-6 h-6 text-dim" />
                    </div>
                    <h4 className="text-lg font-black text-text mb-1 font-satoshi">No referred users yet</h4>
                    <p className="text-muted-custom max-w-[320px] text-sm font-dm-sans">
                      Share your link to start building your network and earning from their trading activity.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-surface rounded-xl overflow-hidden p-5">
                  <NetworkTree tree={tree} loading={false} />
                </div>
              )}
            </div>

            {/* FAQ — 40% */}
            <div className="lg:col-span-2">
              <p className="text-[10px] text-muted-custom uppercase font-bold tracking-widest mb-4">FAQ</p>
              <div className="space-y-2">
                {FAQ_ITEMS.map((item, i) => (
                  <div key={i} className="bg-surface rounded-xl overflow-hidden">
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full p-4 flex items-center justify-between cursor-pointer hover:bg-elevated transition-colors text-left"
                    >
                      <span className="font-medium text-text text-sm font-dm-sans">{item.q}</span>
                      <ChevronDown
                        className={cn(
                          "w-5 h-5 text-yes shrink-0 transition-transform duration-200",
                          openFaq === i && "rotate-180"
                        )}
                      />
                    </button>
                    <AnimatePresence>
                      {openFaq === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <p className="text-muted-custom text-sm font-dm-sans leading-relaxed">{item.a}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "campaigns" && (
          <motion.div
            key="campaigns"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="bg-surface rounded-xl overflow-hidden p-8 min-h-[200px] relative"
          >
            <div className="grid-dots absolute inset-0 opacity-20 pointer-events-none" />
            <div className="relative">
              <div className="w-12 h-12 bg-elevated rounded-xl flex items-center justify-center mb-4">
                <Gift className="w-6 h-6 text-dim" />
              </div>
              <h4 className="text-lg font-black text-text mb-1 font-satoshi">Coming Soon</h4>
              <p className="text-muted-custom text-sm font-dm-sans">Agent campaigns and bonuses will be available here.</p>
            </div>
          </motion.div>
        )}

        {activeTab === "payouts" && (
          <motion.div
            key="payouts"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start"
          >
            {/* Activity Feed */}
            <div className="lg:col-span-3">
              <CommissionFeed userId={user.id} />
            </div>

            {/* Agent Stats + Tier Progress */}
            <div className="lg:col-span-2 space-y-6">
              <AgentStatsGrid stats={stats ?? null} loading={statsLoading} />
              <TierProgress stats={stats ?? null} loading={statsLoading} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
