import { Suspense } from "react";
import { FooterGate } from "@/components/layout/footer-gate";
import { TopNav } from "@/components/layout/top-nav";
import { CompleteProfileModal } from "@/components/auth/complete-profile-modal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageTransitionProvider } from "@/components/providers/page-transition-provider";
import { BottomNavGate } from "@/components/layout/bottom-nav-gate";
import { SpeedSettlementToaster } from "@/components/speed/speed-settlement-toaster";

export default function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <Suspense>
        <TopNav />
      </Suspense>
      <main id="main" className="pt-16 max-w-[1240px] mx-auto px-4 lg:px-6">
        <ErrorBoundary>
          <PageTransitionProvider>
            {children}
          </PageTransitionProvider>
        </ErrorBoundary>
      </main>
      <FooterGate />
      {/* BottomNavGate hides the global BottomNav on /demo/* (demo has its own). */}
      <BottomNavGate />
      {/* Globally-mounted side panels are wrapped in their own ErrorBoundary
          so a render-phase throw in one of them does NOT trip the page-level
          error.tsx and nuke the whole route (iOS Safari regression seen on
          home page after the W12 settlement-toaster rewrite). Sentry still
          records the exception via ErrorBoundary.componentDidCatch. */}
      <ErrorBoundary fallback={null}>
        <CompleteProfileModal />
      </ErrorBoundary>
      {/* Group D: global settlement toaster — surfaces realised P&L when a
          position settles open → won/lost (typically after instant redirect
          to the next round, so it's not tied to any single page). */}
      <ErrorBoundary fallback={null}>
        <SpeedSettlementToaster />
      </ErrorBoundary>
      {/* Parallel @modal slot. Default returns null; intercepting routes
          (e.g. (.)speed/[id]) render mobile-only slide-in overlays here. */}
      {modal}
    </div>
  );
}
