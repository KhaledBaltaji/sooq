"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OdometerProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}

function digitWidth(digit: string): string {
  if (digit === ".") return "0.3em";
  if (digit === ",") return "0.3em";
  if (digit === ":") return "0.22em";
  if (digit === "$") return "0.7em";
  return "0.62em";
}

function Digit({ digit, duration }: { digit: string; duration: number }) {
  return (
    <span
      className="relative inline-block overflow-y-hidden overflow-x-visible"
      style={{ width: digitWidth(digit) }}
    >
      <AnimatePresence mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{
            duration: duration / 1000,
            ease: [0.16, 1, 0.3, 1], // ease-out expo
          }}
          className="inline-block"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function Odometer({
  value,
  format = formatCurrency,
  className,
  duration = 400,
}: OdometerProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      setDisplayValue(value);
      prevValue.current = value;
    }
  }, [value]);

  const formatted = format(displayValue);
  const digits = formatted.split("");

  return (
    <span
      className={cn(
        "inline-flex tabular-nums font-satoshi font-black leading-[1.15]",
        className
      )}
      aria-label={formatted}
    >
      {digits.map((digit, i) => (
        <Digit key={`${i}-${digit}`} digit={digit} duration={duration} />
      ))}
    </span>
  );
}
