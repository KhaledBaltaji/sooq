"use client";

import { useRef, useState, useCallback, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Loader2 } from "lucide-react";

const THRESHOLD = 80;
const MAX_PULL = 130;

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [refreshing, setRefreshing] = useState(false);
  const y = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const pulling = useRef(false);

  // Transforms
  const indicatorOpacity = useTransform(y, [0, 40, THRESHOLD], [0, 0.5, 1]);
  const indicatorScale = useTransform(y, [0, THRESHOLD], [0.5, 1]);
  const indicatorRotate = useTransform(y, [0, THRESHOLD, MAX_PULL], [0, 180, 270]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    // Only activate when scrolled to top
    if (window.scrollY > 0) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current || refreshing) return;
    if (window.scrollY > 0) {
      pulling.current = false;
      y.set(0);
      return;
    }

    const delta = e.touches[0].clientY - startY.current;
    if (delta < 0) {
      y.set(0);
      return;
    }

    // Rubber-band resistance
    const dampened = Math.min(delta * 0.5, MAX_PULL);
    y.set(dampened);

    // Prevent native scroll while pulling
    if (dampened > 10) {
      e.preventDefault();
    }
  }, [refreshing, y]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    const currentY = y.get();

    if (currentY >= THRESHOLD && !refreshing) {
      // Snap to loading position
      animate(y, 60, { type: "spring", stiffness: 400, damping: 30 });
      setRefreshing(true);

      try {
        await onRefresh();
      } finally {
        // Small delay so user sees the spinner
        await new Promise((r) => setTimeout(r, 300));
        setRefreshing(false);
        animate(y, 0, { type: "spring", stiffness: 300, damping: 25 });
      }
    } else {
      // Snap back
      animate(y, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  }, [y, refreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative"
      style={{ touchAction: "manipulation" }}
    >
      {/* Pull indicator */}
      <motion.div
        className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10"
        style={{
          top: -44,
          y,
          opacity: refreshing ? 1 : indicatorOpacity,
          scale: refreshing ? 1 : indicatorScale,
        }}
      >
        <div className="w-9 h-9 rounded-full bg-surface border border-border-custom shadow-lg flex items-center justify-center">
          {refreshing ? (
            <Loader2 className="w-4 h-4 text-yes animate-spin" />
          ) : (
            <motion.svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="text-muted-custom"
              style={{ rotate: indicatorRotate }}
            >
              <path
                d="M8 2v10M4 8l4 4 4-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.svg>
          )}
        </div>
      </motion.div>

      {/* Content */}
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </div>
  );
}
