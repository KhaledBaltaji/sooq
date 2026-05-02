"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { Copy, Check, Share2, UserPlus, DollarSign, TrendingUp, Zap, Lock } from "lucide-react";
import Image from "next/image";
import { AGENT_ACTIVATION_THRESHOLD, NGR_COMMISSION_RATES } from "@/lib/constants";
import { Odometer } from "@/components/ui/odometer";
import { motion } from "framer-motion";

interface ActivationOverlayProps {
  qualifiedCount: number;
  totalEscrowed: number;
  referralLink: string;
}

export function ActivationOverlay({
  qualifiedCount,
  totalEscrowed,
  referralLink,
}: ActivationOverlayProps) {
  const [copied, setCopied] = useState(false);
  const remaining = AGENT_ACTIVATION_THRESHOLD - qualifiedCount;
  const rates = NGR_COMMISSION_RATES[1];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error("Failed to copy to clipboard");
    }
  };

  const shareWhatsApp = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Join me on Sooq! ${referralLink}`)}`,
      "_blank"
    );
  };

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

          {/* Activation Progress — shown on mobile only (appears after hero) */}
          <div className="lg:hidden">
            <ActivationProgressCard
              qualifiedCount={qualifiedCount}
              remaining={remaining}
              totalEscrowed={totalEscrowed}
              delay={0.1}
            />
          </div>

          {/* Share Section — shown on mobile only */}
          <div className="lg:hidden">
            <ShareCard
              referralLink={referralLink}
              copied={copied}
              copyLink={copyLink}
              shareWhatsApp={shareWhatsApp}
              delay={0.15}
            />
          </div>

          {/* How It Works */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="bg-surface rounded-xl overflow-hidden"
          >
            <div className="p-5 lg:p-6">
              <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-4">
                How it works
              </p>
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
              <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-3">
                Earning Potential
              </p>
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

        {/* ─── Right Column: Action ─── */}
        <div className="hidden lg:block lg:col-span-2 space-y-4">

          {/* Activation Progress — desktop only */}
          <ActivationProgressCard
            qualifiedCount={qualifiedCount}
            remaining={remaining}
            totalEscrowed={totalEscrowed}
            delay={0.1}
          />

          {/* Share Section — desktop only */}
          <ShareCard
            referralLink={referralLink}
            copied={copied}
            copyLink={copyLink}
            shareWhatsApp={shareWhatsApp}
            delay={0.2}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Extracted Sub-components ─── */

export function ActivationProgressCard({
  qualifiedCount,
  remaining,
  totalEscrowed,
  delay,
}: {
  qualifiedCount: number;
  remaining: number;
  totalEscrowed: number;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-surface rounded-xl overflow-hidden"
    >
      <div className="p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-3.5 h-3.5 text-yes" />
          <h3 className="text-sm font-satoshi font-black text-text">
            Activate Your Agent Account
          </h3>
        </div>
        <p className="text-xs text-muted-custom mb-5">
          Invite {AGENT_ACTIVATION_THRESHOLD} friends who trade to unlock your commissions
        </p>

        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-muted-custom uppercase font-bold tracking-widest">
            Progress
          </span>
          <span className="text-lg font-black font-satoshi text-yes tabular-nums">
            {qualifiedCount}/{AGENT_ACTIVATION_THRESHOLD}
          </span>
        </div>

        {/* Segmented progress bars */}
        <div className="flex gap-2 mb-4">
          {Array.from({ length: AGENT_ACTIVATION_THRESHOLD }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.3, delay: delay + 0.1 + i * 0.08 }}
              className="flex-1 h-5 rounded-md transition-all duration-300 origin-left"
              style={
                i < qualifiedCount
                  ? {
                      backgroundColor: "var(--yes)",
                      boxShadow: i === qualifiedCount - 1
                        ? "0 0 16px rgba(45, 140, 255, 0.4)"
                        : "0 0 8px rgba(45, 140, 255, 0.2)",
                    }
                  : {
                      backgroundColor: "var(--elevated)",
                    }
              }
            />
          ))}
        </div>

        <p className="text-xs text-muted-custom">
          {remaining > 0
            ? `${remaining} more friend${remaining !== 1 ? "s" : ""} need to join & trade`
            : "You're ready — activation unlocking!"}
        </p>

        {totalEscrowed > 0 && (
          <div className="mt-5 pt-5 border-t border-border-custom/30">
            <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-1">
              Earned so far
            </p>
            <div style={{ textShadow: "0 0 20px rgba(0, 232, 123, 0.25)" }}>
              <Odometer
                value={totalEscrowed}
                className="text-3xl font-satoshi font-black text-success"
              />
            </div>
            <p className="text-[11px] text-muted-custom mt-1">
              Unlocks at {AGENT_ACTIVATION_THRESHOLD} qualified friends
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ShareCard({
  referralLink,
  copied,
  copyLink,
  shareWhatsApp,
  delay,
}: {
  referralLink: string;
  copied: boolean;
  copyLink: () => void;
  shareWhatsApp: () => void;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-surface rounded-xl overflow-hidden"
    >
      <div className="p-5 lg:p-6">
        <p className="text-[10px] text-muted-custom uppercase tracking-widest font-bold mb-3">
          Your link
        </p>

        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 px-3 py-2.5 bg-bg border border-border-custom rounded-lg overflow-hidden">
            <span className="text-xs text-muted-custom truncate block font-mono">
              {referralLink || "sooq.exchange?ref=..."}
            </span>
          </div>
          <button
            onClick={copyLink}
            className="w-10 h-10 bg-elevated border border-border-custom rounded-lg flex items-center justify-center shrink-0 hover:border-yes/40 transition-colors cursor-pointer"
          >
            {copied ? (
              <Check className="w-4 h-4 text-success" />
            ) : (
              <Copy className="w-4 h-4 text-muted-custom" />
            )}
          </button>
        </div>

        <button
          onClick={shareWhatsApp}
          className="w-full h-[52px] bg-success text-white text-base font-satoshi font-black rounded-lg flex items-center justify-center gap-2 transition-all duration-[80ms] cursor-pointer mb-2 shadow-[0_4px_0_0px_rgba(0,140,70,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(0,140,70,0.9)] hover:brightness-110"
        >
          <Image src="/icons/Untitled design (1).png" alt="WhatsApp" width={18} height={18} /> Share on WhatsApp
        </button>
        <button
          onClick={copyLink}
          className="w-full h-10 bg-elevated border border-border-custom text-muted-custom text-sm font-bold rounded-lg flex items-center justify-center gap-2 hover:text-text transition-all cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" /> Copy Link
        </button>
      </div>
    </motion.div>
  );
}
