// W10 home — featured hero + grid + right sidebar.
// Mirrors the prediction-market home shape: main column with the
// SpeedHomeView (hero card + remaining markets grid), and a
// desktop-only right sidebar with PortfolioSidebar (sign-in CTA when
// logged out, balance + positions snapshot when logged in).

import { SpeedHomeView } from "@/components/speed/speed-home-view";
import { PortfolioSidebar } from "@/components/layout/portfolio-sidebar";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 lg:px-6 lg:py-10 xl:grid xl:grid-cols-[1fr_320px] xl:gap-6">
      <main className="min-w-0 flex flex-col gap-8">
        <SpeedHomeView />
      </main>

      <aside className="hidden xl:flex flex-col gap-4 sticky top-24 self-start">
        <PortfolioSidebar />
      </aside>
    </div>
  );
}
