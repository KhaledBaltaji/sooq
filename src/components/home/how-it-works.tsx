"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { HelpCircle, Search, DollarSign, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const stepKeys = [
  "onboardingStep1",
  "onboardingStep2",
  "onboardingStep3",
] as const;

const stepIcons = [Search, DollarSign, Wallet];

// Per-step illustrations. `null` falls back to the icon placeholder.
const stepImages: (string | null)[] = [
  "/onboarding/pick-a-market.jpg",
  "/onboarding/place-a-trade.png",
  "/onboarding/cash-out.png",
];

export function HowItWorksDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const dirMult = locale === "ar" ? -1 : 1;
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(dirMult);

  useEffect(() => {
    if (open) {
      setStep(0);
      setDirection(dirMult);
    }
  }, [open, dirMult]);

  const handleNext = () => {
    if (step < 2) {
      setDirection(1 * dirMult);
      setStep(step + 1);
    } else {
      onOpenChange(false);
    }
  };

  const goToStep = (i: number) => {
    setDirection((i > step ? 1 : -1) * dirMult);
    setStep(i);
  };

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md p-0 overflow-hidden">
        <div className="px-6 pt-10 pb-5">
          {/* Illustration placeholder */}
          <div className="relative overflow-hidden" style={{ minHeight: 200 }}>
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {stepImages[step] ? (
                  <div className="w-full aspect-[16/10] rounded-2xl overflow-hidden bg-elevated">
                    <img
                      src={stepImages[step] as string}
                      alt={t(`${stepKeys[step]}Title`)}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div className="w-full aspect-[16/10] bg-elevated rounded-2xl flex items-center justify-center">
                    {(() => {
                      const Icon = stepIcons[step];
                      return (
                        <div className="flex flex-col items-center gap-3 text-muted-custom">
                          <div className="w-14 h-14 rounded-full bg-yes/10 flex items-center justify-center">
                            <Icon className="w-7 h-7 text-yes" />
                          </div>
                          <span className="text-xs font-medium">
                            {t(`${stepKeys[step]}Title`)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Step title + description */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="mt-5"
            >
              <h3 className="text-xl font-satoshi font-black text-text">
                {step + 1}. {t(`${stepKeys[step]}Title`)}
              </h3>
              <p className="text-sm text-muted-custom mt-2 leading-relaxed">
                {t(`${stepKeys[step]}Desc`)}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-1.5 mt-6">
            {stepKeys.map((_, i) => (
              <button
                key={i}
                onClick={() => goToStep(i)}
                className={`shrink-0 w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                  i === step
                    ? "bg-yes"
                    : "bg-border-custom hover:bg-muted-custom"
                }`}
              />
            ))}
          </div>

          {/* Action button */}
          <button
            onClick={handleNext}
            className="w-full mt-5 h-[52px] rounded-xl font-satoshi font-bold text-[15px] text-white bg-yes
              shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]
              transition-all duration-[80ms]"
          >
            {step < 2 ? t("next") : t("getStarted")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HowItWorks() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("home");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-surface rounded-2xl p-4 text-left hover:bg-elevated transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-yes/10 flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-5 h-5 text-yes" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text">{t("howItWorks")}</p>
          <p className="text-xs text-muted-custom">{t("learnHowToTrade")}</p>
        </div>
      </button>

      <HowItWorksDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
