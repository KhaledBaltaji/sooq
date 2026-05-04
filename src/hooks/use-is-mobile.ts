"use client";

// A9 (Group A): mobile-vs-desktop detection used by speed-market-content
// to decide between the v2 single-screen layout and the desktop two-column
// layout. Threshold matches the project's `lg:` breakpoint (Tailwind 1024px).
//
// Hydration guard: returns false on first render so SSR markup matches
// initial CSR markup. Real value lands on the next tick via useEffect.

import { useEffect, useState } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}
