// W10 home — featured hero + grid + right sidebar.
// Mirrors the prediction-market home shape: main column with the
// SpeedHomeView (hero card + remaining markets grid), and a
// desktop-only right sidebar with PortfolioSidebar (sign-in CTA when
// logged out, balance + positions snapshot when logged in).

import { SpeedHomeView } from "@/components/speed/speed-home-view";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-8 lg:px-8 lg:py-12">
      <SpeedHomeView />
    </div>
  );
}
