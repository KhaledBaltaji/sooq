"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Home, ArrowLeftRight, Gift, User, Building2 } from "lucide-react";
import { cn, triggerHapticLight } from "@/lib/utils";
import { useBranchManager } from "@/hooks/use-branch-manager";
import { AccountSheet } from "./account-sheet";

const ACCOUNT_KEY = "__account__";

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const [accountOpen, setAccountOpen] = useState(false);
  const { managedBranch } = useBranchManager();

  // Detect branch context from URL
  const branchMatch = pathname.match(/^\/b\/([^/]+)/);
  const branchCode = branchMatch?.[1];

  const baseItems = managedBranch
    ? [
        { href: "/", icon: Home, labelKey: "home" as const, noBranchPrefix: false },
        { href: "/trade", icon: ArrowLeftRight, labelKey: "trade" as const, noBranchPrefix: false },
        { href: "/branch/dashboard", icon: Building2, labelKey: "myBranch" as const, noBranchPrefix: true },
        { href: ACCOUNT_KEY, icon: User, labelKey: "account" as const, noBranchPrefix: true },
      ]
    : [
        { href: "/", icon: Home, labelKey: "home" as const, noBranchPrefix: false },
        { href: "/trade", icon: ArrowLeftRight, labelKey: "trade" as const, noBranchPrefix: false },
        { href: "/referral", icon: Gift, labelKey: "agent" as const, noBranchPrefix: false },
        { href: ACCOUNT_KEY, icon: User, labelKey: "account" as const, noBranchPrefix: true },
      ];

  const navItems = branchCode
    ? baseItems.map(item => ({
        ...item,
        href: item.noBranchPrefix ? item.href :
          item.href === "/" ? `/b/${branchCode}` :
          item.href === "/referral" ? `/b/${branchCode}/agent` :
          `/b/${branchCode}${item.href}`,
      }))
    : baseItems;

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
              : branchCode
                ? (href === `/b/${branchCode}` ? pathname === `/b/${branchCode}` || pathname === `/b/${branchCode}/` : pathname.startsWith(href))
                : (href === "/" ? pathname === "/" : pathname.startsWith(href));
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
