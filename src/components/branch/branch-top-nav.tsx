"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BalanceChip } from "@/components/layout/balance-chip";
import { NotificationDropdown } from "@/components/layout/notification-dropdown";
import { ProfileDropdown } from "@/components/layout/profile-dropdown";
import { useUser } from "@/lib/auth/hooks";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";
import { Sun, Moon } from "lucide-react";

interface BranchTopNavProps {
  branchCode: string;
}

export function BranchTopNav({ branchCode }: BranchTopNavProps) {
  const { user } = useUser();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const t = useTranslations("nav");

  const NAV_LINKS = [
    { labelKey: "featured" as const, href: `/b/${branchCode}` },
    { labelKey: "markets" as const, href: `/b/${branchCode}/markets` },
    { labelKey: "agentCorner" as const, href: `/b/${branchCode}/agent` },
    { labelKey: "help" as const, href: `/b/${branchCode}/help` },
  ];

  return (
    <header className="fixed top-0 z-50 w-full bg-bg/95 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80 border-b border-border-custom pt-safe">
      <div className="flex items-center h-16 max-w-[1240px] mx-auto px-4 lg:px-6">
        {/* Left: Branch name + Nav */}
        <div className="flex items-center gap-8 me-auto">
          <Link
            href={`/b/${branchCode}`}
            className="text-2xl font-black tracking-tighter text-text font-satoshi leading-none"
          >
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

        {/* Right: Controls */}
        <div className="flex items-center gap-2.5">
          <BalanceChip />

          <button
            onClick={toggleTheme}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-muted-custom hover:text-text hover:bg-elevated transition-colors cursor-pointer"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
          </button>

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
