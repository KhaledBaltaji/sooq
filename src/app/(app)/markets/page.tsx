import { getCachedAllMarkets } from "@/lib/queries/markets";
import { MarketsPageClient } from "@/components/markets/markets-page-client";

export const revalidate = 60;

export default async function MarketsPage() {
  const markets = await getCachedAllMarkets();

  return <MarketsPageClient initialMarkets={markets} />;
}
