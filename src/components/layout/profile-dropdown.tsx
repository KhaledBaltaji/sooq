"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/hooks";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useWithdrawModal } from "@/components/wallet/withdraw-modal-provider";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Gift,
  Moon,
  Sun,
  Wallet,
  ArrowDownToLine,
  Settings,
  ChevronDown,
  Shield,
  Building2,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

// Branch system stripped W3 — managedBranch always null.
const managedBranch = null;

export function ProfileDropdown() {
  const { user } = useUser();
  const supabase = useSupabase();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { openDepositModal } = useDepositModal();
  const { openWithdrawModal } = useWithdrawModal();
  const t = useTranslations("profileMenu");
  const tSupport = useTranslations("support");
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<NodeJS.Timeout | null>(null);

  // Listen for close events from other dropdowns
  useEffect(() => {
    const handler = () => setOpen(false);
    window.addEventListener("close-profile", handler);
    return () => window.removeEventListener("close-profile", handler);
  }, []);

  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    window.dispatchEvent(new Event("close-notifications"));
    setOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const handleLogout = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/");
  };

  if (!user) return null;

  const displayName = user.display_name || "User";

  return (
    <div
      className="relative"
      ref={dropdownRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Avatar trigger + chevron */}
      <div className="flex items-center gap-1 cursor-pointer">
        <div
          role="button"
          tabIndex={0}
          style={{ width: 32, height: 32, minWidth: 32, minHeight: 32 }}
          className={cn(
            "rounded-full border-2 flex items-center justify-center transition-colors duration-200 overflow-hidden",
            open
              ? "border-yes"
              : "border-border-custom hover:border-yes/60"
          )}
        >
          <Avatar name={displayName} userId={user.id} src={user.avatar_url} size="sm" />
        </div>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-muted-custom transition-transform duration-200",
          open && "rotate-180"
        )} />
      </div>

      {/* Dropdown */}
      <div
        className={cn(
          "absolute end-0 top-full mt-2 w-64 bg-bg border border-border-custom rounded-2xl shadow-xl z-[60] overflow-hidden",
          "transition-all duration-200 origin-top-right",
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
        )}
      >
        {/* User header — clickable to profile */}
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="px-4 py-3 border-b border-border-custom flex items-center gap-3 hover:bg-surface transition-colors"
        >
          <Avatar name={displayName} userId={user.id} src={user.avatar_url} size="sm" />
          <span className="text-sm font-satoshi font-medium text-text truncate">
            {displayName}
          </span>
        </Link>

        {/* Menu items */}
        <div className="py-1">
          <DropdownItem
            icon={Gift}
            label={t("agent")}
            href="/referral"
            onClick={() => setOpen(false)}
          />
          <DropdownItem
            icon={Settings}
            label={t("settings")}
            href="/settings"
            onClick={() => setOpen(false)}
          />
          <DropdownItem
            icon={Wallet}
            label={t("deposit")}
            onClick={() => {
              setOpen(false);
              openDepositModal();
            }}
          />
          <DropdownItem
            icon={ArrowDownToLine}
            label={t("withdraw")}
            onClick={() => {
              setOpen(false);
              openWithdrawModal();
            }}
          />
        </div>

        {/* Role-based links */}
        {(user.is_admin || managedBranch) && (
          <div className="border-t border-border-custom py-1">
            {user.is_admin && (
              <DropdownItem
                icon={Shield}
                label="Admin Panel"
                href="/admin"
                onClick={() => setOpen(false)}
              />
            )}
            {managedBranch && (
              <DropdownItem
                icon={Building2}
                label="My Branch"
                href="/branch/dashboard"
                onClick={() => setOpen(false)}
              />
            )}
          </div>
        )}

        {/* Dark mode toggle */}
        <div className="border-t border-border-custom px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-sm text-text">
            {theme === "dark" ? (
              <Moon className="w-4 h-4 text-yes" />
            ) : (
              <Sun className="w-4 h-4 text-warning" />
            )}
            <span className="font-satoshi font-medium">{t("darkMode")}</span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <ToggleSwitch enabled={theme === "dark"} onToggle={toggleTheme} />
          </div>
        </div>

        {/* Bottom links */}
        <div className="border-t border-border-custom py-1">
          {isSupportWhatsAppConfigured() && (
            <a
              href={getSupportWhatsAppHref(tSupport("whatsAppDefaultMessage"))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm font-satoshi text-muted-custom hover:text-text hover:bg-surface transition-colors"
            >
              {tSupport("contactWhatsApp")}
            </a>
          )}
          <DropdownLink label={t("termsOfUse")} href="/terms" onClick={() => setOpen(false)} />
        </div>

        {/* Logout */}
        <div className="border-t border-border-custom">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 text-left text-sm font-satoshi text-no hover:bg-surface transition-colors cursor-pointer"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DropdownItem({
  icon: Icon,
  label,
  href,
  onClick,
}: {
  icon: typeof Gift;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-satoshi text-text hover:bg-surface transition-colors cursor-pointer";

  if (href) {
    return (
      <Link href={href} onClick={onClick} className={className}>
        <Icon className="w-4 h-4 text-muted-custom" />
        {label}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      <Icon className="w-4 h-4 text-muted-custom" />
      {label}
    </button>
  );
}

function DropdownLink({
  label,
  href,
  onClick,
}: {
  label: string;
  href: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-2 text-sm font-satoshi text-muted-custom hover:text-text hover:bg-surface transition-colors"
    >
      {label}
    </Link>
  );
}
