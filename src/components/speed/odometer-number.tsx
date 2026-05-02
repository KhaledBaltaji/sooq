"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

interface OdometerNumberProps {
  value: number;
  /** Number of decimal places to show. Default 2 (USD-style). */
  decimals?: number;
  /** Optional currency / unit prefix shown before the number (e.g. "$"). */
  prefix?: string;
  className?: string;
  /** Tween duration in seconds. Default 0.4. */
  duration?: number;
}

/**
 * Smoothly tweens between numeric values via framer-motion (already in
 * deps). When `value` changes, animates the displayed number from the
 * previous value to the new value over `duration` seconds — the digit
 * "rolling" effect commonly called an odometer.
 *
 * Used in `SpeedHeroCard` to display the live BTC oracle price below the
 * title without flashing on every tick.
 */
export function OdometerNumber({
  value,
  decimals = 2,
  prefix = "",
  className,
  duration = 0.4,
}: OdometerNumberProps) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (v) =>
    `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`,
  );

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [value, motionValue, duration]);

  return <motion.span className={className}>{display}</motion.span>;
}
