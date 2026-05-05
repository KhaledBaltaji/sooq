"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useUser } from "@/lib/auth/hooks";
import { isSuperAdmin, canAccessView } from "@/lib/admin-views";
import {
  useAdminSidebarCounts,
  type AdminSidebarCounts,
} from "@/hooks/use-admin-sidebar-counts";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Which count field (from `get_admin_sidebar_counts`) drives each nav item's
 * red-dot badge. Items without a `badgeKey` never show a badge.
 */
type BadgeKey = keyof AdminSidebarCounts;

interface NavItem {
  key: string;
  href: string;
  icon: string;
  label: string;
  badgeKey?: BadgeKey;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

// W4 strip: slim admin to surviving pages only.
// Removed: markets, amm, agents, branches, finance, stats, accounting,
// alerts, logs, help. Most of the corresponding RPCs/tables were dropped
// in W2/W3. The lean ops rebuild between W10 and W11 will add back a
// minimal alerts/logs surface.
const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { key: "dashboard", href: "/admin", icon: "dashboard", label: "Dashboard" },
      { key: "stats", href: "/admin/stats", icon: "bar_chart", label: "Stats" },
    ],
  },
  {
    group: "Markets",
    items: [
      { key: "speed", href: "/admin/speed", icon: "bolt", label: "Speed Markets" },
    ],
  },
  {
    group: "People",
    items: [
      { key: "users", href: "/admin/users", icon: "group", label: "Users" },
    ],
  },
  {
    group: "Money",
    items: [
      { key: "withdrawals", href: "/admin/money", icon: "account_balance_wallet", label: "Money", badgeKey: "pending_finance" },
      { key: "fees", href: "/admin/fees", icon: "payments", label: "Fees" },
    ],
  },
  {
    group: "Content",
    items: [
      { key: "help", href: "/admin/help", icon: "help", label: "Help Center" },
    ],
  },
  {
    group: "Platform",
    items: [
      { key: "admins", href: "/admin/admins", icon: "shield_person", label: "Admins" },
    ],
  },
];

function NavItems({ onNavigate, allowedViews }: { onNavigate?: () => void; allowedViews: string[] | null }) {
  const pathname = usePathname();
  const counts = useAdminSidebarCounts();

  const isItemVisible = (item: NavItem) => {
    if (item.key === "admins") return isSuperAdmin(allowedViews);
    return canAccessView(allowedViews, item.key);
  };

  // Filter groups: keep only those with at least one visible item
  const visibleGroups = ADMIN_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(isItemVisible) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav className="flex-1 overflow-y-auto pb-6">
      {visibleGroups.map((group, groupIdx) => (
        <div key={group.group} className={cn("space-y-0.5", groupIdx > 0 && "mt-5")}>
          <div className="px-6 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            {group.group}
          </div>
          {group.items.map(({ href, icon, label, badgeKey }) => {
            const isActive =
              href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(href);

            const badgeCount = (badgeKey ? counts[badgeKey] : 0) ?? 0;
            const showBadge = badgeCount > 0;

            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-6 py-2.5 transition-colors duration-150 ease-in-out font-[family-name:var(--font-inter)] text-sm",
                  isActive
                    ? "border-l-[3px] border-[var(--yes,#2D8CFF)] bg-white/5 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/10",
                )}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {icon}
                </span>
                <span className="flex-1">{label}</span>
                {showBadge && (
                  <span
                    className="ms-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--error,#ef4444)] text-white text-[10px] font-bold leading-none"
                    aria-label={`${badgeCount} new`}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminSidebar({ allowedViews }: { allowedViews: string[] | null }) {
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const displayName = user?.display_name || user?.email?.split("@")[0] || "Admin";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Desktop sidebar — fixed */}
      <aside className="hidden md:flex flex-col h-screen w-64 fixed start-0 top-0 bg-[#0b0f10] border-r border-black/40 z-50">
        <div className="px-8 py-10">
          <h1 className="text-xl font-black text-white tracking-widest uppercase font-[family-name:var(--font-manrope)]">
            sooq Admin
          </h1>
          <p className="text-[10px] text-[#9a9d9f] font-bold tracking-[0.2em] mt-1 uppercase">
            Institutional Grade
          </p>
        </div>

        <NavItems allowedViews={allowedViews} />

        {/* Bottom user card */}
        <div className="p-6 mt-auto">
          <div className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
            <div className="w-10 h-10 rounded-lg bg-[#565e74] flex items-center justify-center text-white text-xs font-bold">
              {initials}
            </div>
            <div className="overflow-hidden">
              <p className="text-white text-xs font-bold truncate">{displayName}</p>
              <p className="text-slate-500 text-[10px] truncate">{user?.email || "Admin"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar + sheet */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#0b0f10] border-b border-black/40 h-14 flex items-center px-4">
        <button onClick={() => setOpen(true)} className="p-2 text-white">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="text-white text-sm font-bold ml-2 font-[family-name:var(--font-manrope)] tracking-wider uppercase">
          sooq Admin
        </span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-64 bg-[#0b0f10] border-none p-0">
            <SheetTitle className="px-8 pt-10 pb-6 text-xl font-black text-white tracking-widest uppercase font-[family-name:var(--font-manrope)]">
              sooq Admin
            </SheetTitle>
            <NavItems onNavigate={() => setOpen(false)} allowedViews={allowedViews} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
