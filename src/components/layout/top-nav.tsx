"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BalanceChip } from "./balance-chip";
import { NotificationDropdown } from "./notification-dropdown";
import { ProfileDropdown } from "./profile-dropdown";
import { useUser } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";

// W10: speed-only v1 — strip nav back to live routes. Markets, agent
// corner and help were design holdovers from the LMSR era; they 404 on
// the slim build. Re-add them when we wire up real pages in W10 polish
// or after launch.
const NAV_LINKS = [
  { labelKey: "featured" as const, href: "/" },
];

export function TopNav() {
  const pathname = usePathname();
  const { user } = useUser();
  const t = useTranslations("nav");

  return (
    <header className="fixed top-0 z-50 w-full bg-bg/95 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80 pt-safe">
      <div className="flex items-center h-16 max-w-[1240px] mx-auto px-4 lg:px-6">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8 me-auto">
          <Link href="/" className="flex items-center gap-0 text-2xl font-black tracking-tighter text-text font-satoshi leading-none">
            sooq
          </Link>
          <nav className="hidden md:flex items-stretch self-stretch gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "font-satoshi text-sm font-medium tracking-tight transition-colors px-3 flex items-center border-b-2",
                    isActive
                      ? "text-text border-yes"
                      : "text-muted-custom hover:text-text border-transparent"
                  )}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Controls — mobile simplified, desktop full */}
        <div className="flex items-center gap-2.5">
          <BalanceChip />

          {/* Desktop: notifications + profile dropdown */}
          {user ? (
            <div className="hidden md:flex items-center gap-3">
              <NotificationDropdown />
              <ProfileDropdown />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
