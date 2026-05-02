"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  endsAt: string;
  className?: string;
  /**
   * "closing" (default) — red + pulse when within 2h of `endsAt`.
   * "upcoming" — neutral styling (used when counting down to `opens_at`).
   */
  variant?: "closing" | "upcoming";
}

export function CountdownTimer({ endsAt, className, variant = "closing" }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState(formatCountdown(endsAt));
  const [pulse, setPulse] = useState(false);

  const isClosingSoon =
    variant === "closing" && new Date(endsAt).getTime() - Date.now() < 2 * 60 * 60 * 1000;

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(formatCountdown(endsAt));
      if (isClosingSoon) {
        setPulse((p) => !p);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt, isClosingSoon]);

  return (
    <span
      className={cn(
        "text-xs font-dm-sans tabular-nums",
        isClosingSoon ? "text-error" : "text-inherit",
        isClosingSoon && pulse && "opacity-80",
        className
      )}
    >
      {timeLeft}
    </span>
  );
}
