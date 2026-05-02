"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Confetti } from "@/components/ui/confetti";
import { Odometer } from "@/components/ui/odometer";
import { shareOnWhatsApp, copyToClipboard, getShareUrl } from "@/lib/prelaunch-share";
import { springs, fadeUp, stagger } from "@/lib/motion";
import { WhatsAppIcon } from "@/components/icons/whatsapp";

interface DoneViewProps {
  position: number;
  referralCode: string;
  onPredictMore: () => void;
}

export function DoneView({ position, referralCode, onPredictMore }: DoneViewProps) {
  const t = useTranslations("prelaunch");
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== "undefined" ? getShareUrl(referralCode) : "";
  const shareMessage = t("shareMessage");

  const handleCopy = async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <Confetti trigger={true} duration={2000} particleCount={50} />

      <motion.div
        className="w-full max-w-sm flex flex-col items-center gap-6"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springs.smooth}
      >
        {/* Position */}
        <motion.div
          className="text-center space-y-2"
          {...fadeUp}
          transition={springs.smooth}
        >
          <div className="text-5xl mb-2">
            <Odometer
              value={position}
              format={(n) => `#${n}`}
              className="text-5xl text-yes"
            />
          </div>
          <p className="text-lg font-satoshi font-bold text-text">
            {t("positionLabel", { position })}
          </p>
          <p className="text-sm text-muted-custom">{t("inviteFriends")}</p>
        </motion.div>

        {/* Share buttons */}
        <motion.div
          className="w-full space-y-3"
          {...fadeUp}
          transition={{ ...springs.smooth, ...stagger(1, 0.15) }}
        >
          {/* WhatsApp */}
          <button
            onClick={() => shareOnWhatsApp(shareMessage, shareUrl)}
            className="w-full h-14 rounded-lg bg-[#25D366] text-white font-satoshi font-bold text-lg flex items-center justify-center gap-2 shadow-[0_4px_0_0px_rgba(18,100,50,0.9)] hover:shadow-[0_3px_0_0px_rgba(18,100,50,0.9)] hover:translate-y-[1px] active:shadow-[0_1px_0_0px_rgba(18,100,50,0.9)] active:translate-y-[3px] hover:brightness-110 transition-all duration-[80ms]"
          >
            <WhatsAppIcon className="w-5 h-5" />
            {t("shareWhatsApp")}
          </button>

          {/* Copy link */}
          <button
            onClick={handleCopy}
            className="w-full h-12 rounded-lg bg-surface text-text font-medium text-sm border border-border hover:bg-elevated transition-colors"
          >
            {copied ? "✓ " : ""}{copied ? t("copyLink") + "!" : t("copyLink")}
          </button>
        </motion.div>

        {/* Predict more */}
        <motion.button
          onClick={onPredictMore}
          className="text-sm text-muted-custom underline underline-offset-2"
          {...fadeUp}
          transition={{ ...springs.smooth, ...stagger(2, 0.15) }}
        >
          {t("predictMore")}
        </motion.button>
      </motion.div>
    </div>
  );
}
