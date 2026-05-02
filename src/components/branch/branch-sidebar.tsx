"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useUser } from "@/lib/auth/hooks";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type { BranchStatus, BranchBookType } from "@/types/branch";
import { BRANCH_STATUS_CONFIG } from "@/types/branch";

interface BranchSidebarProps {
  branchName: string;
  branchStatus: BranchStatus;
  bookType?: BranchBookType;
}

const RESELLER_NAV = [
  { href: "/branch/dashboard", icon: "dashboard", label: "Dashboard" },
  { href: "/branch/dashboard/users", icon: "group", label: "Users" },
  { href: "/branch/dashboard/agents", icon: "support_agent", label: "Agents" },
  { href: "/branch/dashboard/revenue", icon: "payments", label: "Revenue" },
  { href: "/branch/dashboard/markets", icon: "storefront", label: "Markets" },
  { href: "/branch/dashboard/pool", icon: "account_balance", label: "Pool Ledger" },
];

// Commission branches: no pool, no markets, no revenue — just attribution + people.
const COMMISSION_NAV = [
  { href: "/branch/dashboard", icon: "dashboard", label: "Dashboard" },
  { href: "/branch/dashboard/users", icon: "group", label: "Users" },
  { href: "/branch/dashboard/agents", icon: "support_agent", label: "Sub-Agents" },
  { href: "/branch/dashboard/commissions", icon: "payments", label: "Commissions" },
];

function NavItems({
  onNavigate,
  bookType,
}: {
  onNavigate?: () => void;
  bookType?: BranchBookType;
}) {
  const pathname = usePathname();
  const items = bookType === "commission" ? COMMISSION_NAV : RESELLER_NAV;

  return (
    <nav className="flex-1 space-y-1">
      {items.map(({ href, icon, label }) => {
        const isActive =
          href === "/branch/dashboard"
            ? pathname === "/branch/dashboard"
            : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-6 py-3 transition-colors duration-150 ease-in-out font-[family-name:var(--font-inter)] text-sm",
              isActive
                ? "border-l-[3px] border-[var(--yes,#2D8CFF)] bg-white/5 text-white font-medium"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/10"
            )}
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {icon}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BranchSidebar({ branchName, branchStatus, bookType }: BranchSidebarProps) {
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const displayName = user?.display_name || user?.email?.split("@")[0] || "Manager";
  const initials = displayName.slice(0, 2).toUpperCase();
  const statusConf = BRANCH_STATUS_CONFIG[branchStatus] || BRANCH_STATUS_CONFIG.active;

  const BranchHeader = () => (
    <div className="px-8 py-10">
      <h1 className="text-lg font-black text-white tracking-wide font-[family-name:var(--font-manrope)]">
        {branchName}
      </h1>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <div className={cn("w-2 h-2 rounded-full", statusConf.dotClass)} />
        <span className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase">
          {statusConf.label}
        </span>
        {bookType === "commission" && (
          <span className="text-[9px] font-bold text-indigo-300 tracking-[0.15em] uppercase">
            · Commission
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col h-screen w-64 fixed start-0 top-0 bg-[#0b0f10] shadow-[4px_0_24px_rgba(0,0,0,0.04)] z-50">
        <BranchHeader />
        <NavItems bookType={bookType} />

        {/* Bottom user card */}
        <div className="p-6 mt-auto">
          <div className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
            <div className="w-10 h-10 rounded-lg bg-[#565e74] flex items-center justify-center text-white text-xs font-bold">
              {initials}
            </div>
            <div className="overflow-hidden">
              <p className="text-white text-xs font-bold truncate">{displayName}</p>
              <p className="text-slate-500 text-[10px] truncate">
                {bookType === "commission" ? "Commission Branch" : "Branch Manager"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar + sheet */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#0b0f10] h-14 flex items-center px-4">
        <button onClick={() => setOpen(true)} className="p-2 text-white">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <span className="text-white text-sm font-bold ml-2 font-[family-name:var(--font-manrope)]">
          {branchName}
        </span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-64 bg-[#0b0f10] border-none p-0">
            <SheetTitle className="sr-only">{branchName} Navigation</SheetTitle>
            <BranchHeader />
            <NavItems onNavigate={() => setOpen(false)} bookType={bookType} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
