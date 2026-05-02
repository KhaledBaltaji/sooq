"use client";

import { usePathname } from "next/navigation";

/**
 * Returns true when the current URL is under /demo/*.
 *
 * This is the single source of truth for "is this page in demo mode?"
 * Live hooks (useExecuteTrade, useMarket, usePositions, etc.) call this
 * to decide whether to route queries and RPCs to `demo_*` tables or to
 * the live ones. Matches the /demo/* contained-route architecture
 * invariant documented in CLAUDE.md §Demo Mode.
 *
 * Server components cannot use this — they should either skip demo
 * rendering or use a server-side equivalent.
 */
export function useDemoMode(): boolean {
  const pathname = usePathname();
  return pathname?.startsWith("/demo") ?? false;
}
