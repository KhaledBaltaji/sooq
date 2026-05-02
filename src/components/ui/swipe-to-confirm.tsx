"use client";

import { useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface SwipeToConfirmProps {
  onConfirm: () => void;
  label?: string;
  disabled?: boolean;
  variant?: "yes" | "no" | "close";
  className?: string;
}

export function SwipeToConfirm({
  onConfirm,
  label = "Swipe to confirm",
  disabled = false,
  variant = "yes",
  className,
}: SwipeToConfirmProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const x = useMotionValue(0);

  const THRESHOLD = 0.8; // 80% of container width to confirm

  // Fade label as handle moves
  const labelOpacity = useTransform(x, [0, 100], [1, 0]);

  // Background fill as handle moves right
  const bgWidth = useTransform(x, (val) => `${val + 48}px`);

  const accentColor = variant === "yes" ? "var(--yes)" : variant === "no" ? "var(--no)" : "var(--dim)";
  const bgClass = variant === "yes" ? "bg-yes" : variant === "no" ? "bg-no" : "bg-dim";

  const handleDragEnd = () => {
    if (disabled || confirmed) return;

    const container = containerRef.current;
    if (!container) return;

    const maxDrag = container.clientWidth - 48; // handle width
    const currentX = x.get();

    if (currentX >= maxDrag * THRESHOLD) {
      // Confirmed — snap to end
      setConfirmed(true);
      animate(x, maxDrag, { type: "spring", stiffness: 300, damping: 30 });
      onConfirm();
    } else {
      // Not enough — spring back
      animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-14 rounded-full overflow-hidden select-none",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
        variant === "yes" ? "bg-yes/10" : variant === "no" ? "bg-no/10" : "bg-dim/10",
        className
      )}
    >
      {/* Fill background */}
      <motion.div
        className={cn("absolute inset-y-0 left-0 rounded-full", bgClass, "opacity-20")}
        style={{ width: bgWidth }}
      />

      {/* Label */}
      <motion.span
        className="absolute inset-0 flex items-center justify-center text-sm font-dm-sans font-medium"
        style={{
          opacity: labelOpacity,
          color: accentColor,
        }}
      >
        {confirmed ? "Confirmed!" : label}
      </motion.span>

      {/* Draggable handle */}
      <motion.div
        drag={disabled || confirmed ? false : "x"}
        dragConstraints={containerRef}
        dragElastic={0}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className={cn(
          "absolute top-1 left-1 bottom-1 w-12 rounded-full",
          "flex items-center justify-center",
          bgClass,
          "text-white shadow-lg",
          "z-10"
        )}
      >
        <ChevronRight className="w-5 h-5" />
      </motion.div>
    </div>
  );
}
