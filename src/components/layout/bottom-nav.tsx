"use client";

// W3 strip: dropped branch-aware routing (`/b/[code]/*`), `/trade` (LMSR
// trade flow), `/referral` (commission UI), `/branch/dashboard` (branch
// admin). Slim bottom nav for Sooq Speed: Home + Account.

import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Home, User } from "lucide-react";
import { cn, triggerHapticLight } from "@/lib/utils";
import { AccountSheet } from "./account-sheet";

const ACCOUNT_KEY = "__account__";

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [accountOpen, setAccountOpen] = useState(false);

  const navItems = [
    { href: "/", icon: Home, labelKey: "home" as const },
    { href: ACCOUNT_KEY, icon: User, labelKey: "account" as const },
  ];

  const handleTap = useCallback((href: string) => {
    triggerHapticLight();
    if (href === ACCOUNT_KEY) {
      setAccountOpen(true);
      return;
    }
    router.push(href);
  }, [router]);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border-custom lg:hidden pb-safe shadow-[0_-1px_0_0_var(--border)]"
        aria-label="Main navigation"
        style={{ touchAction: "manipulation" }}
      >
        <div className="flex items-center justify-around h-16 px-2">
          {navItems.map(({ href, icon: Icon, labelKey }) => {
            const isAccount = href === ACCOUNT_KEY;
            const isActive = isAccount
              ? accountOpen || pathname.startsWith("/profile")
              : href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);
            return (
              <button
                key={href}
                type="button"
                onClick={() => handleTap(href)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-md transition-colors min-w-0 min-h-[48px] [-webkit-tap-highlight-color:transparent]",
                  isActive
                    ? "text-yes bg-yes/5"
                    : "text-dim hover:text-text"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="font-satoshi text-[11px] font-medium">{t(labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}
