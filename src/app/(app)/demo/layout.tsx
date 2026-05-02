"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Home, LineChart, Settings as SettingsIcon, User } from "lucide-react";
import Link from "next/link";
import { useUser } from "@/lib/auth/hooks";
import { useSupabase } from "@/components/providers/supabase-provider";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { BalanceChip } from "@/components/layout/balance-chip";
import { AccountSheet } from "@/components/layout/account-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Demo layout: wraps every /demo/* page with the DEMO banner + balance chip
 * and a demo-scoped bottom nav. Unauthenticated visitors are redirected to
 * the login modal; users who haven't yet initialized demo get a splash that
 * calls toggle_demo_mode(true) to grant their $10K starter balance.
 *
 * The parent (app)/layout.tsx hides its generic BottomNav when pathname
 * starts with /demo, so this layout's bottom nav is the only mobile nav here.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: userLoading } = useUser();
  const supabase = useSupabase();
  const t = useTranslations("demo");

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    // Unauthenticated visitors: bounce to home (which renders the login prompt)
    if (!userLoading && !user) {
      router.replace("/");
    }
  }, [user, userLoading, router]);

  const needsInit = Boolean(user) && !user?.demo_first_enabled_at;

  const handleStartDemo = async () => {
    setEnabling(true);
    setEnableError(null);
    const { error } = await supabase.rpc("toggle_demo_mode" as never, { p_enabled: true } as never);
    if (error) {
      setEnableError(error.message);
      setEnabling(false);
      return;
    }
    // The realtime subscription on users will update the profile; meanwhile
    // show loading for a tick so the UI doesn't flicker.
    setTimeout(() => setEnabling(false), 400);
  };

  if (userLoading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!user) return null;

  // Splash: user is authenticated but has never enabled demo.
  if (needsInit) {
    return (
      <div className="min-h-[60vh] max-w-lg mx-auto py-12 px-4 flex flex-col items-center text-center gap-6">
        <div className="rounded-full bg-amber-500/20 p-4">
          <span className="text-4xl">🎯</span>
        </div>
        <h1 className="text-3xl font-satoshi font-black text-text">
          {t("splash.title")}
        </h1>
        <p className="text-base text-muted-custom leading-relaxed">
          {t("splash.body")}
        </p>
        <button
          type="button"
          onClick={handleStartDemo}
          disabled={enabling}
          className="rounded-lg bg-amber-500 px-6 py-3 text-base font-satoshi font-black text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
        >
          {enabling ? t("trade.executing") : t("splash.button")}
        </button>
        {enableError && <p className="text-sm text-no">{enableError}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <DemoBanner />
      <div className="flex items-center justify-end gap-3 px-4 pt-3 pb-2 max-w-[1240px] mx-auto w-full">
        <BalanceChip />
      </div>
      <main className="flex-1 pb-24 lg:pb-8">{children}</main>

      {/* Demo bottom nav (mobile): 4 items including Account which opens the
          AccountSheet with the Demo/Live toggle. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-amber-500/30 lg:hidden pb-safe"
        aria-label="Demo navigation"
      >
        <div className="flex items-center justify-around h-16 px-2">
          <DemoNavButton
            href="/demo/markets"
            icon={<Home className="w-5 h-5" />}
            label={t("nav.markets")}
            active={pathname === "/demo" || pathname.startsWith("/demo/markets") || pathname.startsWith("/demo/market")}
          />
          <DemoNavButton
            href="/demo/positions"
            icon={<LineChart className="w-5 h-5" />}
            label={t("nav.positions")}
            active={pathname.startsWith("/demo/positions")}
          />
          <DemoNavButton
            href="/demo/settings"
            icon={<SettingsIcon className="w-5 h-5" />}
            label={t("nav.settings")}
            active={pathname.startsWith("/demo/settings")}
          />
          <DemoNavButton
            icon={<User className="w-5 h-5" />}
            label={t("nav.account")}
            active={accountOpen}
            onClick={() => setAccountOpen(true)}
          />
        </div>
      </nav>

      {/* AccountSheet — same component used by live bottom-nav. Contains the
          Demo/Live toggle row so users can flip back to live without leaving
          the /demo/* route. */}
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}

function DemoNavButton({
  href,
  icon,
  label,
  active,
  onClick,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-md transition-colors min-w-0 min-h-[48px]",
    active ? "text-amber-600 bg-amber-500/10" : "text-dim hover:text-text"
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {icon}
        <span className="font-satoshi text-[11px] font-medium">{label}</span>
      </button>
    );
  }
  return (
    <Link href={href!} className={className}>
      {icon}
      <span className="font-satoshi text-[11px] font-medium">{label}</span>
    </Link>
  );
}
