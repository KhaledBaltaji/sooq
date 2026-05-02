"use client";

import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { springs } from "@/lib/motion";
import { CategoryBadge } from "./category-badge";

interface QuestionCardProps {
  question: {
    id: string;
    title_ar: string;
    title_en: string;
    description_ar?: string | null;
    description_en?: string | null;
    category: string;
  };
  onVote: (vote: "yes" | "no") => void;
  result?: { yesCount: number; noCount: number };
  userVote?: "yes" | "no";
  showResult: boolean;
  questionNumber: number;
  totalQuestions: number;
  onNext: () => void;
}

export function QuestionCard({
  question,
  onVote,
  result,
  userVote,
  showResult,
  onNext,
}: QuestionCardProps) {
  const locale = useLocale();
  const t = useTranslations("prelaunch");
  const title = locale === "ar" ? question.title_ar : question.title_en;
  const description = locale === "ar" ? question.description_ar : question.description_en;

  if (showResult && result) {
    const total = result.yesCount + result.noCount;
    const yesPercent = total > 0 ? Math.round((result.yesCount / total) * 100) : 50;
    const noPercent = 100 - yesPercent;
    const isWithMajority =
      (userVote === "yes" && yesPercent >= 50) ||
      (userVote === "no" && noPercent >= 50);

    return (
      <div
        className="flex flex-col items-center justify-center h-full px-5 cursor-pointer select-none"
        onClick={onNext}
      >
        <div className="w-full flex flex-col items-center gap-6">
          <CategoryBadge category={question.category} />

          <h2 className="text-2xl font-satoshi font-bold text-text text-center leading-snug max-w-lg">
            {title}
          </h2>

          {/* Result bars */}
          <div className="w-full max-w-lg space-y-3">
            {/* YES bar */}
            <div className="relative w-full h-14 rounded-xl overflow-hidden bg-surface">
              <motion.div
                className="absolute inset-y-0 left-0 bg-yes rounded-xl"
                initial={{ width: "50%" }}
                animate={{ width: `${yesPercent}%` }}
                transition={springs.smooth}
              />
              <div className="relative h-full flex items-center justify-between px-4">
                <span className="text-base font-satoshi font-bold text-white uppercase tracking-wide">
                  {t("yes")}
                </span>
                <span className="text-xl font-satoshi font-black text-white">
                  {yesPercent}%
                </span>
              </div>
            </div>

            {/* NO bar */}
            <div className="relative w-full h-14 rounded-xl overflow-hidden bg-surface">
              <motion.div
                className="absolute inset-y-0 left-0 bg-no rounded-xl"
                initial={{ width: "50%" }}
                animate={{ width: `${noPercent}%` }}
                transition={springs.smooth}
              />
              <div className="relative h-full flex items-center justify-between px-4">
                <span className="text-base font-satoshi font-bold text-white uppercase tracking-wide">
                  {t("no")}
                </span>
                <span className="text-xl font-satoshi font-black text-white">
                  {noPercent}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-custom px-1">
              <span>
                {isWithMajority ? t("majority") : t("minority")}
              </span>
              <span>{t("votes", { count: total })}</span>
            </div>
          </div>

          {/* Navigation hint */}
          <motion.p
            className="text-sm text-muted-custom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            {t("tapNext")}
          </motion.p>
        </div>
      </div>
    );
  }

  // Pre-vote state
  return (
    <div className="flex flex-col items-center justify-center h-full px-5 select-none">
      <div className="w-full flex flex-col items-center gap-8 max-w-lg">
        <CategoryBadge category={question.category} />

        <div className="space-y-3 text-center">
          <h2 className="text-3xl font-satoshi font-black text-text leading-snug">
            {title}
          </h2>
          {description && (
            <p className="text-base text-muted-custom">{description}</p>
          )}
        </div>

        <div className="flex gap-3 w-full">
          <button
            onClick={() => onVote("yes")}
            className="flex-1 h-[52px] rounded-xl bg-yes text-white font-satoshi font-bold text-lg uppercase tracking-wide shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)] transition-all duration-[80ms]"
          >
            {t("yes")}
          </button>
          <button
            onClick={() => onVote("no")}
            className="flex-1 h-[52px] rounded-xl bg-no text-white font-satoshi font-bold text-lg uppercase tracking-wide shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)] transition-all duration-[80ms]"
          >
            {t("no")}
          </button>
        </div>
      </div>
    </div>
  );
}
