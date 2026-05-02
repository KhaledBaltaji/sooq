"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { SpeedMarketContent } from "@/components/speed/speed-market-content";

/**
 * Module-scope timestamp survives React StrictMode's dev-only double-mount
 * cycle. Skip the second slide-in within 500ms.
 */
let lastSlideStartedAt = 0;

/**
 * Mobile-only intercepting route fired on client-side navigation from a
 * sibling route. Direct URL hits and desktop nav both fall through to the
 * standalone `(app)/speed/[id]/page.tsx`.
 *
 * Why desktop is excluded: when the modal slot is mounted, intercepting
 * routes hold `{children}` on the parent route. On desktop we tried
 * rendering an overlay there to keep the home grid mounted underneath, but
 * the overlay sat above the TopNav, blocking nav-link clicks. Simpler to
 * skip the intercept on desktop entirely and let the standalone route
 * render normally — the cost is a re-mount of the home grid on back, which
 * is the pre-Phase-9 baseline and not user-painful.
 */
export default function SpeedMarketModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [isClosing, setIsClosing] = useState(false);
  // After the slide-out animation completes, flip the wrapper to
  // `opacity-0 invisible` so there's nothing for the user to "blink"
  // away when the route changes and the wrapper unmounts. The element
  // is already off-screen via translateX, but invisible+pointer-events-none
  // doubly guarantees no paint contribution during the unmount frame.
  const [isHidden, setIsHidden] = useState(false);

  // Slide-in decision is one-shot at mount.
  const [shouldSlide] = useState(() => {
    if (typeof window === "undefined") return true;
    // Phase 12D: auto-redirect from a previous /speed/[id] (round expired
    // → swap to next live round) sets this flag right before
    // router.replace. The card stays in place, only data updates.
    try {
      if (sessionStorage.getItem("speed-suppress-slide") === "1") {
        sessionStorage.removeItem("speed-suppress-slide");
        return false;
      }
    } catch {
      // ignore — private mode / quota
    }
    const elapsed = Date.now() - lastSlideStartedAt;
    if (elapsed < 500) return false;
    lastSlideStartedAt = Date.now();
    return true;
  });

  const handleBack = () => {
    if (isClosing) return;
    setIsClosing(true);
  };

  // Once the slide-out animation completes:
  //   1) Hide the wrapper visually (opacity-0 invisible) — eliminates
  //      anything that could "blink" during the route swap.
  //   2) Defer the route change to a React transition so the URL update
  //      is non-urgent and React doesn't force a synchronous paint.
  //   3) The wrapper unmounts naturally on the next render.
  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName !== "exit" || !isClosing) return;
    setIsHidden(true);
    startTransition(() => router.back());
  };

  // The modal is `fixed inset-x-0 top-0 bottom-16 z-50` with
  // `overscroll-contain` — it already covers the home content area and
  // traps scroll within itself. We previously also flipped `body` to
  // `position: fixed` to lock the underlying scroll, but that pattern
  // displaces the body and snaps it back on cleanup, causing a visible
  // jitter on close. Skipping the body lock keeps the home page static
  // beneath the modal AND eliminates the snap-back. The home doesn't
  // scroll while the modal is open because nothing the user can touch
  // reaches it.

  // Desktop: skip the modal entirely. The standalone /speed/[id] route
  // handles desktop nav and TopNav links keep working.
  if (isDesktop) return null;

  return (
    <div
      className={cn(
        // `inset-0 z-50` — full-viewport overlay above the TopNav. The
        // page's own `SpeedMobileTradeBar` is fixed-positioned and renders
        // inside the modal subtree, so the bottom of the slide naturally
        // includes the trade controls (the global BottomNav stays hidden
        // on /speed/* via `BottomNavGate`). Earlier we left a 64px strip
        // for the BottomNav, but on /speed/[id] the gate hides it anyway,
        // leaving an empty strip that read as a "cut footer" during the
        // slide animation.
        "fixed inset-0 z-50 bg-bg overflow-y-auto overscroll-contain duration-300 ease-out",
        // Left-edge drop-shadow so as the card slides in from the right,
        // it visibly casts a shadow over the home page underneath —
        // makes the overlay read as "stacked above" instead of replacing
        // the page.
        "shadow-[-12px_0_36px_rgba(0,0,0,0.25)]",
        // Slide-out beats slide-in when both could match; check first.
        isClosing
          ? "animate-out slide-out-to-right"
          : shouldSlide
            ? "animate-in slide-in-from-right"
            : "",
        // After slide-out finishes, mute the wrapper so nothing visible
        // remains for the unmount frame to remove → no blink.
        isHidden && "opacity-0 invisible pointer-events-none",
      )}
      role="dialog"
      aria-modal="true"
      onAnimationEnd={handleAnimationEnd}
    >
      {/* No chevron header here — the v2 Strip inside SpeedRoundV2 owns
          the back button. We pass `handleBack` so v2's chevron triggers
          the slide-out animation (sets isClosing) instead of an instant
          router.back. */}

      {/* Pre-unmount the entire heavy subtree the moment the user taps
          back. By the time the slide-out finishes and the route changes,
          there's no chart / supabase channels / intervals to clean up
          on the unmount frame — eliminates the jitter. */}
      {!isClosing && (
        <SpeedMarketContent
          params={params}
          inModal
          isClosing={isClosing}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
