"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SpeedMarketContent } from "@/components/speed/speed-market-content";

/**
 * Standalone /speed/[id] route. Fires on:
 *   - Cold load (refresh, direct URL hit) on either viewport
 *   - Desktop click from a card (the intercepting modal route returns null
 *     on desktop and we force a full nav from the cards, which lands here)
 *
 * Behaviour:
 *   - Mobile cold load → bounce to home. The user expects refresh-while-on-
 *     a-speed-market to drop them back at the home grid (no chevron, no
 *     standalone speed page on mobile). The mobile experience is the
 *     overlay modal only; standalone is for desktop.
 *   - Desktop → render the full standalone speed page as before.
 */
export default function SpeedMarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (!isDesktop) {
      router.replace("/");
      return;
    }
    setShouldRender(true);
  }, [router]);

  if (!shouldRender) return null;

  return <SpeedMarketContent params={params} />;
}
