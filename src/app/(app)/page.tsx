// W10 home page — rebuilt from W2 placeholder. Renders the live speed
// markets feed (cards) for the user's primary entry point. Clicking a
// card navigates to `/speed/[id]` for the full trade panel + chart.
// Per master plan W4: "Speed market becomes the home page, not a sub-route."

import { SpeedMarketsFeed } from "@/components/speed/speed-markets-feed";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 lg:px-6 lg:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Speed markets</h1>
        <p className="text-sm text-muted-custom max-w-2xl">
          BTC over/under markets settling every 5 minutes, 15 minutes, and 24
          hours. Pick a side, hold or cash out anytime.
        </p>
      </header>
      <SpeedMarketsFeed />
    </main>
  );
}
