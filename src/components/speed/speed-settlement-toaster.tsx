"use client";

// Group D: global settlement toaster.
//
// Watches the user's positions for status transitions:
//   open → won      → green toast `+$payout-stake` + green mid-screen pop
//   open → lost     → red toast   `−$stake`        + red mid-screen pop
//   open → refunded → silent balance refund (no toast/pop — quiet refund)
//
// Two visual surfaces:
// 1. Corner toast (top-center) — the original Group D treatment.
// 2. Mid-screen pop — same animation as the chart-pop fired by user
//    cashouts (.speed-pnl-pop), but `position: fixed` so it survives the
//    instant redirect to the next market. This makes settlement wins
//    feel as good as a manual cashout.
//
// Side effects on transition:
// - On `won` / `refunded`, optimistically adjust the user's BAL chip and
//   trigger a /api/users/me refetch so the top-right balance reconciles
//   in the same render frame as the toast/pop. Mirrors the pattern from
//   useSpeedExecuteTrade and useSpeedCashout.

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useSpeedPositions } from "@/hooks/use-speed-positions";
import { useUserContext } from "@/components/providers/user-provider";
import { cn, formatCurrency } from "@/lib/utils";

interface ToastState {
  id: number;
  type: "win" | "loss";
  amount: number;
  exiting: boolean;
}

interface PopState {
  id: number;
  type: "win" | "loss";
  amount: number;
}

const TOAST_HOLD_MS = 4500;
const TOAST_EXIT_MS = 280;
// Match the .speed-pnl-pop / .speed-settlement-pop keyframe duration in
// globals.css. Must clear the DOM after the animation completes so the
// `key` change retriggers cleanly on the next event.
const POP_LIFETIME_MS = 1000;

export function SpeedSettlementToaster() {
  const { positions } = useSpeedPositions();
  const { adjustBalance, refetch: refetchUser } = useUserContext();
  const seenStatusesRef = useRef<Map<string, string>>(new Map());
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [pop, setPop] = useState<PopState | null>(null);
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
    let latestPop: PopState | null = null;
    let creditDelta = 0;
    for (const p of positions) {
      const prev = seenStatusesRef.current.get(p.id);
      seenStatusesRef.current.set(p.id, p.status);
      if (prev !== "open") continue;
      if (p.status === "won") {
        const stake = Number(p.stake);
        const payout = Number(p.payout_amount ?? 0);
        const realised = Math.max(0, payout - stake);
        newToasts.push({
          id: Date.now() + Math.random(),
          type: "win",
          amount: realised,
          exiting: false,
        });
        latestPop = {
          id: Date.now() + Math.random(),
          type: "win",
          amount: realised,
        };
        // Server credited the full payout (including the stake that was
        // debited at trade open). Optimistic update so the BAL chip in
        // the top-right jumps in the same frame as the toast.
        if (Number.isFinite(payout) && payout > 0) creditDelta += payout;
      } else if (p.status === "lost") {
        const stake = Number(p.stake);
        newToasts.push({
          id: Date.now() + Math.random(),
          type: "loss",
          amount: -stake,
          exiting: false,
        });
        latestPop = {
          id: Date.now() + Math.random(),
          type: "loss",
          amount: -stake,
        };
        // No balance change — stake was already debited at trade open.
      } else if (p.status === "refunded") {
        // Quiet refund: no toast, no pop. Still credit the BAL because
        // the server returned the stake. Common cause: oracle gap voided
        // the round before resolution.
        const stake = Number(p.stake);
        if (Number.isFinite(stake) && stake > 0) creditDelta += stake;
      }
    }
    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts]);
    }
    // Only the latest pop is shown — if multiple positions settle at
    // once, queueing them would overlap visually. The corner toasts
    // already enumerate every settlement.
    if (latestPop) setPop(latestPop);
    if (creditDelta > 0) {
      adjustBalance(creditDelta);
      // Reconcile against the server's authoritative balance ~50ms later.
      // Single refetch per batch even when both UP+DOWN settle on the
      // same market.
      void refetchUser();
    }
  }, [positions, adjustBalance, refetchUser]);

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

  // Clear the mid-screen pop after its CSS animation completes so the
  // `key` change retriggers cleanly on the next settlement event.
  useEffect(() => {
    if (!pop) return;
    const id = setTimeout(() => setPop(null), POP_LIFETIME_MS);
    return () => clearTimeout(id);
  }, [pop]);

  if (toasts.length === 0 && !pop) return null;

  return (
    <>
      {pop && (
        <div
          key={pop.id}
          className={cn("speed-settlement-pop", pop.type)}
          aria-hidden
        >
          {pop.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(pop.amount))}
        </div>
      )}
      {toasts.length > 0 && (
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
                  {t.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(t.amount))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
