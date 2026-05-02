"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./bottom-nav";

/**
 * Conditionally renders the global <BottomNav/>. Suppressed on:
 *   /demo/* — demo layout has its own scoped bottom nav
 *
 * Note: /speed/[id] used to be suppressed here too (the page substitutes
 * SpeedMobileTradeBar at the bottom), but on mobile the standalone
 * /speed/[id] route now redirects to home, and the modal route covers
 * the BottomNav with a z-50 overlay anyway. Keeping BottomNav mounted
 * across all paths means it doesn't have to remount on back-nav from the
 * modal — eliminating a late-mount jitter the user reported.
 */
export function BottomNavGate() {
  const pathname = usePathname();
  if (pathname === "/demo" || pathname.startsWith("/demo/")) {
    return null;
  }
  return <BottomNav />;
}
