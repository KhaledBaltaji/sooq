"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { fadeUp, springs, stagger } from "@/lib/motion";

const steps = [
  { step: "1", titleKey: "step1Title", descKey: "step1Desc" },
  { step: "2", titleKey: "step2Title", descKey: "step2Desc" },
  { step: "3", titleKey: "step3Title", descKey: "step3Desc" },
] as const;

interface ExplainViewProps {
  onContinue: () => void;
}

export function ExplainView({ onContinue }: ExplainViewProps) {
  const t = useTranslations("prelaunch");

  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        {/* Header */}
        <motion.div
          className="text-center space-y-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <h2 className="text-2xl font-satoshi font-black text-text">
            {t("explainTitle")}
          </h2>
          <p className="text-sm text-muted-custom">{t("explainSubtitle")}</p>
        </motion.div>

        {/* Steps */}
        <div className="w-full space-y-4">
          {steps.map((step, i) => (
            <motion.div
              key={step.titleKey}
              className="flex items-start gap-4 p-4 rounded-xl bg-surface"
              {...fadeUp}
              transition={{ ...springs.smooth, ...stagger(i, 0.15) }}
            >
              <span className="w-10 h-10 rounded-full bg-yes/10 text-yes font-satoshi font-bold text-lg flex items-center justify-center shrink-0">{step.step}</span>
              <div>
                <h3 className="font-satoshi font-bold text-text">
                  {t(step.titleKey)}
                </h3>
                <p className="text-sm text-muted-custom mt-0.5">
                  {t(step.descKey)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.button
          onClick={onContinue}
          className="w-full h-14 rounded-lg bg-yes text-white font-satoshi font-bold text-lg shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] hover:shadow-[0_3px_0_0px_rgba(15,60,140,0.9)] hover:translate-y-[1px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] hover:brightness-110 transition-all duration-[80ms]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.5 }}
        >
          {t("signupCta")}
        </motion.button>
      </div>
    </div>
  );
}
