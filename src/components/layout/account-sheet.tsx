"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Gift,
  Settings,
  Wallet,
  ArrowDownToLine,
  Shield,
  Building2,
  Moon,
  Sun,
  Languages,
} from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/ui/avatar";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useUser } from "@/lib/auth/hooks";
import { signOut as authSignOut } from "@/lib/auth/actions";
import { useTheme } from "@/components/providers/theme-provider";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useWithdrawModal } from "@/components/wallet/withdraw-modal-provider";
// Branch system stripped W3 — managedBranch always null.
const managedBranch = null;
import { cn } from "@/lib/utils";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

interface AccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSheet({ open, onOpenChange }: AccountSheetProps) {
  const locale = useLocale();
  const side = locale === "ar" ? "left" : "right";

  const { user } = useUser();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const { openWithdrawModal } = useWithdrawModal();
  const t = useTranslations("profileMenu");
  const tSupport = useTranslations("support");
  const tChip = useTranslations("balanceChip");

  const close = () => onOpenChange(false);

  const handleLogout = async () => {
    close();
    await authSignOut();
    router.push("/");
  };

  // Locale swap — writes cookie then reloads so next-intl picks up the new
  // locale at request time. Matches the pattern in src/components/profile/language-toggle.tsx.
  const setLocale = (newLocale: "en" | "ar") => {
    if (newLocale === locale) return;
    document.cookie = `locale=${newLocale};path=/;max-age=31536000`;
    window.location.reload();
  };

  const displayName = user?.display_name || "User";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        className="p-0 flex flex-col bg-bg border-border-custom w-[85vw] sm:max-w-sm"
        showCloseButton={false}
      >
        {user ? (
          <>
            {/* Header — tap to open full profile page */}
            <Link
              href="/profile"
              onClick={close}
              className="px-4 py-4 border-b border-border-custom flex items-center gap-3 hover:bg-surface transition-colors"
            >
              <Avatar
                name={displayName}
                userId={user.id}
                src={user.avatar_url}
                size="md"
              />
              <span className="text-lg font-satoshi font-semibold text-text truncate">
                {displayName}
              </span>
            </Link>

            {/* Primary menu */}
            <div className="py-1">
              <MenuLink icon={Gift} label={t("agent")} href="/referral" onClick={close} />
              <MenuLink icon={Settings} label={t("settings")} href="/settings" onClick={close} />
              <MenuButton
                icon={Wallet}
                label={t("deposit")}
                onClick={() => {
                  close();
                  openDepositModal();
                }}
              />
              <MenuButton
                icon={ArrowDownToLine}
                label={t("withdraw")}
                onClick={() => {
                  close();
                  openWithdrawModal();
                }}
              />
            </div>

            {/* Role-based */}
            {(user.is_admin || managedBranch) && (
              <div className="border-t border-border-custom py-1">
                {user.is_admin && (
                  <MenuLink icon={Shield} label="Admin Panel" href="/admin" onClick={close} />
                )}
                {managedBranch && (
                  <MenuLink
                    icon={Building2}
                    label="My Branch"
                    href="/branch/dashboard"
                    onClick={close}
                  />
                )}
              </div>
            )}

            {/* Dark mode toggle */}
            <div className="border-t border-border-custom px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-base text-text">
                {theme === "dark" ? (
                  <Moon className="w-5 h-5 text-yes" />
                ) : (
                  <Sun className="w-5 h-5 text-warning" />
                )}
                <span className="font-satoshi font-medium">{t("darkMode")}</span>
              </div>
              <ToggleSwitch enabled={theme === "dark"} onToggle={toggleTheme} />
            </div>

            {/* Language selector */}
            <LanguageRow locale={locale} setLocale={setLocale} label={t("language")} />

            {/* Bottom links */}
            <div className="border-t border-border-custom py-1">
              {isSupportWhatsAppConfigured() && (
                <WhatsAppLink
                  label={tSupport("contactWhatsApp")}
                  message={tSupport("whatsAppDefaultMessage")}
                  onClick={close}
                />
              )}
              <PlainLink label={t("termsOfUse")} href="/terms" onClick={close} />
            </div>

            {/* Logout */}
            <div className="border-t border-border-custom mt-auto">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full px-4 py-3.5 text-left text-base font-satoshi text-no hover:bg-surface transition-colors cursor-pointer"
              >
                {t("logout")}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Guest auth CTA */}
            <div className="px-4 py-5 border-b border-border-custom">
              <button
                type="button"
                onClick={() => {
                  close();
                  openLoginModal();
                }}
                className="w-full h-11 px-4 flex items-center justify-center rounded-lg bg-yes text-white text-sm font-satoshi font-bold cursor-pointer hover:bg-yes/90 transition-colors"
              >
                {tChip("signIn")}
              </button>
            </div>

            {/* Dark mode toggle */}
            <div className="border-b border-border-custom px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-base text-text">
                {theme === "dark" ? (
                  <Moon className="w-5 h-5 text-yes" />
                ) : (
                  <Sun className="w-5 h-5 text-warning" />
                )}
                <span className="font-satoshi font-medium">{t("darkMode")}</span>
              </div>
              <ToggleSwitch enabled={theme === "dark"} onToggle={toggleTheme} />
            </div>

            {/* Language selector */}
            <LanguageRow locale={locale} setLocale={setLocale} label={t("language")} borderTop={false} />

            {/* Bottom links */}
            <div className="py-1">
              {isSupportWhatsAppConfigured() && (
                <WhatsAppLink
                  label={tSupport("contactWhatsApp")}
                  message={tSupport("whatsAppDefaultMessage")}
                  onClick={close}
                />
              )}
              <PlainLink label={t("termsOfUse")} href="/terms" onClick={close} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const ITEM_CLASSES =
  "w-full flex items-center gap-2.5 px-4 py-3.5 text-base font-satoshi text-text hover:bg-surface transition-colors cursor-pointer";

function MenuLink({
  icon: Icon,
  label,
  href,
  onClick,
}: {
  icon: typeof Gift;
  label: string;
  href: string;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className={ITEM_CLASSES}>
      <Icon className="w-5 h-5 text-muted-custom" />
      {label}
    </Link>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Gift;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={ITEM_CLASSES}>
      <Icon className="w-5 h-5 text-muted-custom" />
      {label}
    </button>
  );
}

function PlainLink({
  label,
  href,
  onClick,
}: {
  label: string;
  href: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-3 text-base font-satoshi text-muted-custom hover:text-text hover:bg-surface transition-colors"
    >
      {label}
    </Link>
  );
}

function WhatsAppLink({
  label,
  message,
  onClick,
}: {
  label: string;
  message: string;
  onClick: () => void;
}) {
  return (
    <a
      href={getSupportWhatsAppHref(message)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="block px-4 py-3 text-base font-satoshi text-muted-custom hover:text-text hover:bg-surface transition-colors"
    >
      {label}
    </a>
  );
}

// Language selector row — mirrors the dark-mode row pattern (icon + label on
// the start, pill toggle on the end). Writes `locale` cookie + reload on
// change, matching src/components/profile/language-toggle.tsx behavior.
function LanguageRow({
  locale,
  setLocale,
  label,
  borderTop = true,
}: {
  locale: string;
  setLocale: (next: "en" | "ar") => void;
  label: string;
  borderTop?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3.5 flex items-center justify-between",
        borderTop ? "border-t border-border-custom" : "border-b border-border-custom"
      )}
    >
      <div className="flex items-center gap-2.5 text-base text-text">
        <Languages className="w-5 h-5 text-muted-custom" />
        <span className="font-satoshi font-medium">{label}</span>
      </div>
      <div className="inline-flex rounded-lg bg-elevated p-1 gap-1">
        <button
          type="button"
          onClick={() => setLocale("en")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-satoshi font-bold transition-all cursor-pointer",
            locale === "en"
              ? "bg-yes text-white shadow-sm"
              : "text-muted-custom hover:text-text hover:bg-surface"
          )}
          aria-pressed={locale === "en"}
          aria-label="English"
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLocale("ar")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-noto-arabic font-bold transition-all cursor-pointer",
            locale === "ar"
              ? "bg-yes text-white shadow-sm"
              : "text-muted-custom hover:text-text hover:bg-surface"
          )}
          aria-pressed={locale === "ar"}
          aria-label="العربية"
        >
          ع
        </button>
      </div>
    </div>
  );
}
