"use client";

// Group D: global settlement toaster.
//
// Watches the user's positions for status transitions:
//   open → won  → green toast `+$payout-stake`
//   open → lost → red toast   `−$stake`
// Pairs with the chart-pop animation (which fires for user-initiated
// cashouts on the same chart). This toast covers the case where the
// market resolves at close while the user has already been redirected to
// the next round (instant redirect — see speed-market-content.tsx). The
// toast is a global overlay so it survives page navigation.

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useSpeedPositions } from "@/hooks/use-speed-positions";
import { cn } from "@/lib/utils";

interface ToastState {
  id: number;
  type: "win" | "loss";
  amount: number;
  exiting: boolean;
}

const TOAST_HOLD_MS = 4500;
const TOAST_EXIT_MS = 280;

export function SpeedSettlementToaster() {
  const { positions } = useSpeedPositions();
  const seenStatusesRef = useRef<Map<string, string>>(new Map());
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (!positions) return;
    // First load: snapshot the current statuses without firing toasts.
    // Otherwise every refresh would re-fire for already-resolved positions.
    if (!initialisedRef.current) {
      positions.forEach((p) => seenStatusesRef.current.set(p.id, p.status));
      initialisedRef.current = true;
      return;
    }
    const newToasts: ToastState[] = [];
    for (const p of positions) {
      const prev = seenStatusesRef.current.get(p.id);
      seenStatusesRef.current.set(p.id, p.status);
      if (prev === "open" && (p.status === "won" || p.status === "lost")) {
        const stake = Number(p.stake);
        const payout = Number(p.payout_amount ?? 0);
        if (p.status === "won") {
          const realised = Math.max(0, payout - stake);
          newToasts.push({
            id: Date.now() + Math.random(),
            type: "win",
            amount: realised,
            exiting: false,
          });
        } else {
          newToasts.push({
            id: Date.now() + Math.random(),
            type: "loss",
            amount: -stake,
            exiting: false,
          });
        }
      }
    }
    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts]);
    }
  }, [positions]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter((t) => !t.exiting)
      .map((t) =>
        setTimeout(() => {
          setToasts((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, exiting: true } : x)),
          );
          setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }, TOAST_EXIT_MS);
        }, TOAST_HOLD_MS),
      );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="speed-toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn("speed-toast", t.type, t.exiting && "exiting")}
          onClick={() =>
            setToasts((prev) =>
              prev.map((x) => (x.id === t.id ? { ...x, exiting: true } : x)),
            )
          }
          role="button"
          tabIndex={0}
        >
          <span className="speed-toast-badge" aria-hidden>
            {t.type === "win" ? (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <X className="h-4 w-4" strokeWidth={2.5} />
            )}
          </span>
          <div className="flex flex-col">
            <span className="speed-toast-title">
              {t.type === "win" ? "Trade closed · Profit" : "Trade closed · Loss"}
            </span>
            <span className="speed-toast-amount">
              {t.amount >= 0 ? "+" : "−"}${Math.abs(t.amount).toFixed(2)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
