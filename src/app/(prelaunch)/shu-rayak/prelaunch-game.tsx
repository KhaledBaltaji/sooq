"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { getLocalVotes } from "@/lib/prelaunch-visitor";
import { StoriesView } from "./stories-view";
import { ExplainView } from "./explain-view";
import { WaitlistView } from "./waitlist-view";
import { DoneView } from "./done-view";

type Phase = "loading" | "stories" | "explain" | "waitlist" | "done";

interface Question {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string;
  description_ar?: string | null;
  description_en?: string | null;
  category: string;
  yes_count: number;
  no_count: number;
  sort_order: number;
}

export function PrelaunchGame() {
  const t = useTranslations("prelaunch");
  const searchParams = useSearchParams();
  const refCode = searchParams.get("ref");

  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [waitlistData, setWaitlistData] = useState<{
    position: number;
    referralCode: string;
  } | null>(null);

  // Fetch questions on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/prelaunch/questions");
        const data = await res.json();
        setQuestions(data.questions || []);
        setPhase("stories");
      } catch (err) {
        console.error("Failed to fetch prelaunch questions:", err);
        // Retry once after 2 seconds
        setTimeout(async () => {
          try {
            const res = await fetch("/api/prelaunch/questions");
            const data = await res.json();
            setQuestions(data.questions || []);
            setPhase("stories");
          } catch (retryErr) {
            console.error("Retry failed for prelaunch questions:", retryErr);
            setPhase("stories");
          }
        }, 2000);
      }
    }
    load();
  }, []);

  const renderPhase = () => {
    switch (phase) {
      case "loading":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            <motion.span
              className="text-3xl font-satoshi font-black text-text tracking-tight"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              sooq
            </motion.span>
            <span className="text-lg text-muted-custom font-satoshi">
              {t("tagline")}
            </span>
            <div className="w-8 h-8 border-2 border-yes border-t-transparent rounded-full animate-spin" />
          </div>
        );
      case "stories":
        return (
          <StoriesView
            questions={questions}
            onComplete={() => setPhase("explain")}
          />
        );
      case "explain":
        return <ExplainView onContinue={() => setPhase("waitlist")} />;
      case "waitlist":
        return (
          <WaitlistView
            referralCode={refCode}
            votes={getLocalVotes()}
            onComplete={(data) => {
              setWaitlistData(data);
              setPhase("done");
            }}
          />
        );
      case "done":
        return waitlistData ? (
          <DoneView
            position={waitlistData.position}
            referralCode={waitlistData.referralCode}
            onPredictMore={() => setPhase("stories")}
          />
        ) : null;
    }
  };

  return (
    <div className="h-full">
      {renderPhase()}
    </div>
  );
}
