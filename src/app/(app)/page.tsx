import { getCachedOpenMarkets } from "@/lib/queries/markets";
import { HomeContentClient } from "@/components/home/home-content-client";
import { logger } from "@/lib/logger";
import type { MarketWithAmm } from "@/types/market";

export const revalidate = 60;

export default async function HomePage() {
  let markets: MarketWithAmm[] = [];
  let fetchFailed = false;

  try {
    markets = await getCachedOpenMarkets();
  } catch (err) {
    logger.error(
      "homepage SSR markets fetch failed",
      { source: "homepage-ssr" },
      err
    );
    fetchFailed = true;
  }

  return <HomeContentClient initialMarkets={markets} fetchFailed={fetchFailed} />;
}
