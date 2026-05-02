"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { QuestionCard } from "./question-card";
import {
  getVisitorId,
  getLocalVotes,
  saveLocalVote,
} from "@/lib/prelaunch-visitor";

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
}

interface StoriesViewProps {
  questions: Question[];
  onComplete: () => void;
}

const AUTO_ADVANCE_MS = 4000;

export function StoriesView({ questions, onComplete }: StoriesViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [votes, setVotes] = useState<Record<string, "yes" | "no">>({});
  const [results, setResults] = useState<
    Record<string, { yesCount: number; noCount: number }>
  >({});
  const [showResult, setShowResult] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goToNextRef = useRef<() => void>(() => {});
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load locally cached votes on mount
  useEffect(() => {
    const local = getLocalVotes();
    if (Object.keys(local).length > 0) {
      setVotes(local);
    }
  }, []);

  // Auto-advance timer — only runs on result screens
  useEffect(() => {
    if (!showResult) return;

    const id = setTimeout(() => {
      goToNextRef.current();
    }, AUTO_ADVANCE_MS);
    timerRef.current = id;

    return () => clearTimeout(id);
  }, [showResult, currentIndex]);

  const goToNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (currentIndex >= questions.length - 1) {
      onComplete();
      return;
    }

    setShowResult(false);
    setCurrentIndex((prev) => prev + 1);
  }, [currentIndex, questions.length, onComplete]);

  // Keep ref in sync so timer always calls latest version
  goToNextRef.current = goToNext;

  const handleVote = useCallback(
    async (vote: "yes" | "no") => {
      const question = questions[currentIndex];
      const visitorId = getVisitorId();

      // Optimistic update
      setVotes((prev) => ({ ...prev, [question.id]: vote }));
      saveLocalVote(question.id, vote);
      setResults((prev) => ({
        ...prev,
        [question.id]: {
          yesCount:
            question.yes_count + (vote === "yes" ? 1 : 0),
          noCount:
            question.no_count + (vote === "no" ? 1 : 0),
        },
      }));
      setShowResult(true);

      // Fetch actual counts
      try {
        const res = await fetch("/api/prelaunch/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            vote,
            visitorId,
          }),
        });
        const data = await res.json();
        if (data.yesCount !== undefined) {
          setResults((prev) => ({
            ...prev,
            [question.id]: {
              yesCount: data.yesCount,
              noCount: data.noCount,
            },
          }));
        }
      } catch {
        // Keep optimistic counts on error
      }
    },
    [currentIndex, questions]
  );

  // Prevent pull-to-refresh on touch devices
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!showResult) return;
      const deltaY = touchStartY.current - e.changedTouches[0].clientY;
      if (deltaY > 50) {
        goToNext();
      }
    },
    [showResult, goToNext]
  );

  const current = questions[currentIndex];
  if (!current) return null;

  return (
    <div
      ref={containerRef}
      className="relative h-full touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 px-4 pt-4">
        {questions.map((q, i) => (
          <div
            key={q.id}
            className="flex-1 h-1 rounded-full bg-text/20 overflow-hidden"
          >
            {i < currentIndex ? (
              <div className="h-full w-full bg-text/80 rounded-full" />
            ) : i === currentIndex && showResult ? (
              <motion.div
                className="h-full bg-text/80 rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: AUTO_ADVANCE_MS / 1000, ease: "linear" }}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* Question card */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="absolute inset-0"
      >
        <QuestionCard
          question={current}
          onVote={handleVote}
          result={results[current.id]}
          userVote={votes[current.id]}
          showResult={showResult}
          questionNumber={currentIndex + 1}
          totalQuestions={questions.length}
          onNext={goToNext}
        />
      </motion.div>

      {/* sooq branding */}
      <div className="absolute top-10 left-4 pointer-events-none z-10">
        <span className="text-sm font-satoshi font-black text-muted-custom/40 tracking-tight">
          sooq
        </span>
      </div>
    </div>
  );
}
