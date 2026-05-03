// W10 home page — featured hero + markets grid layout.
// Per master plan W4: "Speed market becomes the home page, not a sub-route."
// Mirrors the prediction-market home shape (one big hero card, then the
// rest of the markets in a grid below) but speed-only.

import { SpeedHomeView } from "@/components/speed/speed-home-view";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-4 py-6 lg:px-6 lg:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Speed markets</h1>
        <p className="text-sm text-muted-custom max-w-2xl">
          BTC over/under markets settling every 5 minutes, 15 minutes, and 24
          hours. Pick a side, hold or cash out anytime.
        </p>
      </header>
      <SpeedHomeView />
    </main>
  );
}
