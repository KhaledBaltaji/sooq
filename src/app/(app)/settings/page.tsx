"use client";

// W7 cutover: settings page off Supabase entirely.
// - MFA section stripped (Auth.js doesn't ship a TOTP primitive; locked
//   decision in master plan: "passwordless throughout"). Re-add post-W10.
// - Referrals UI stripped (multi-level commission system gone in W3).
// - Demo mode card stripped (demo system gone in W2).
// - Profile updates now go through PATCH /api/users/profile.
// - Account delete uses /api/users/profile to soft-blank PII + Auth.js signOut.

import { useState, useEffect, useRef, useCallback } from "react";
import { useUser } from "@/lib/auth/hooks";
import { useTheme } from "@/components/providers/theme-provider";
import { useTranslations } from "next-intl";
import { LanguageToggle } from "@/components/profile/language-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth/actions";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  User as UserIcon,
  Shield,
  Bell,
  ArrowLeft,
  LogOut,
  AlertCircle,
  Mail,
  BellRing,
} from "lucide-react";
import type { User } from "@/types/user";

type SettingsTab = "profile" | "account" | "notifications";

const TAB_ICONS: Record<SettingsTab, typeof UserIcon> = {
  profile: UserIcon,
  account: Shield,
  notifications: Bell,
};

const TAB_KEYS: SettingsTab[] = ["profile", "account", "notifications"];

export default function SettingsPage() {
  const { user, authUser, loading } = useUser();
  const { theme, toggleTheme } = useTheme();
  const t = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-4">
        <Skeleton className="h-8 w-32 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="px-4 py-16 text-center space-y-4">
        <p className="text-muted-custom text-sm">{t("signInToViewSettings")}</p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-yes text-white rounded-lg font-satoshi font-bold text-sm"
        >
          {t("goHome")}
        </Link>
      </div>
    );
  }

  const displayName = user.display_name || "Anonymous";

  return (
    <div className="max-w-4xl mx-auto py-4 lg:py-6 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/profile"
          className="p-2 rounded-lg text-muted-custom hover:text-text hover:bg-surface transition-colors"
        >
          <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" />
        </Link>
        <h1 className="font-satoshi font-black text-xl text-text">{t("title")}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <div className="flex lg:flex-col gap-1 h-fit">
          {TAB_KEYS.map((tabId) => {
            const Icon = TAB_ICONS[tabId];
            return (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-satoshi font-medium transition-colors cursor-pointer w-full text-left",
                  activeTab === tabId
                    ? "bg-surface text-text font-bold"
                    : "text-muted-custom hover:text-text hover:bg-surface/50"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(`${tabId}Tab`)}
              </button>
            );
          })}
          <form action={signOut} className="mt-2 pt-2 border-t border-border-custom/30">
            <button
              type="submit"
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-satoshi font-medium text-no hover:bg-no/5 transition-colors cursor-pointer w-full text-left"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {t("logOut")}
            </button>
          </form>
        </div>

        <div key={activeTab} className="animate-in fade-in duration-200">
          {activeTab === "profile" && (
            <ProfileTab displayName={displayName} user={user} email={authUser?.email || ""} />
          )}
          {activeTab === "account" && (
            <AccountTab theme={theme} toggleTheme={toggleTheme} />
          )}
          {activeTab === "notifications" && <NotificationsTab />}
        </div>
      </div>
    </div>
  );
}

/* ─── Profile Tab ─── */
function ProfileTab({
  displayName,
  user,
  email,
}: {
  displayName: string;
  user: User;
  email: string;
}) {
  const { refetch } = useUser();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [name, setName] = useState(displayName);
  const [bio, setBio] = useState(user.bio || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initialLoadRef = useRef(true);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);

    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name.trim(),
          bio: bio.trim() || null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        refetch();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // Auto-save: silently fail; the user can retry by editing again.
    } finally {
      setSaving(false);
    }
  }, [name, bio, refetch]);

  // Auto-save with debounce when name or bio changes
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      handleSave();
    }, 800);
    return () => clearTimeout(timer);
  }, [name, bio, handleSave]);

  const isSyntheticEmail = email.endsWith("@phone.sooq.exchange");

  return (
    <div className="space-y-6">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("profileSettings")}</h2>

      <Avatar name={user.display_name || "User"} userId={user.id} src={user.avatar_url} size="xl" />

      <SettingsField label={t("username")}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none transition-colors"
        />
      </SettingsField>

      {/* Email — read-only in v1; Auth.js owns the email update flow,
          phone-only users have synthetic emails. */}
      {!isSyntheticEmail && email && (
        <SettingsField label={t("email")}>
          <div className="px-3 py-2.5 bg-elevated rounded-lg text-sm text-muted-custom font-dm-sans">
            {email}
          </div>
        </SettingsField>
      )}

      <SettingsField label={t("bio")}>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("bioPlaceholder")}
          rows={3}
          maxLength={250}
          className="w-full px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none transition-colors resize-none"
        />
        <p className="text-[11px] text-dim text-right">{bio.length}/250</p>
      </SettingsField>

      <SettingsField label={t("language")}>
        <LanguageToggle />
      </SettingsField>

      {(saving || saved) && (
        <p className={cn(
          "text-xs font-satoshi font-medium transition-opacity",
          saved ? "text-success" : "text-muted-custom"
        )}>
          {saved ? `✓ ${t("saved")}` : saving ? tc("saving") : ""}
        </p>
      )}
    </div>
  );
}

/* ─── Account Tab ─── */
function AccountTab({
  theme,
  toggleTheme,
}: {
  theme: string;
  toggleTheme: () => void;
}) {
  const { user } = useUser();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE" || !user) return;
    setDeleting(true);

    try {
      // Soft-delete: blank PII via the profile route. The account row is
      // kept (still referenced by transactions) but display_name + bio +
      // avatar are cleared. Admin freezes via /api/admin/users/freeze
      // separately if needed.
      await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: "[deleted]",
          bio: null,
          avatar_url: null,
        }),
      });
    } finally {
      // Always sign out — even if the blank failed; the user wants out.
      await signOut();
      window.location.href = "/login";
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("accountSettings")}</h2>

      {/* Appearance */}
      <div className="space-y-3">
        <h3 className="font-satoshi font-medium text-base text-text">{t("appearance")}</h3>
        <div className="border border-border-custom rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-satoshi font-medium text-text">{t("darkMode")}</p>
            <p className="text-xs text-muted-custom mt-0.5">
              {t("darkModeDescription")}
            </p>
          </div>
          <ToggleSwitch enabled={theme === "dark"} onToggle={toggleTheme} />
        </div>
      </div>

      {/* Delete Account */}
      <div className="space-y-3">
        <h3 className="font-satoshi font-medium text-base text-text">{t("deleteAccount")}</h3>
        <div className="flex items-center gap-3 bg-no/5 border border-no/10 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-no shrink-0" />
          <p className="text-base text-no">
            {t("deleteAccountDescription")}
          </p>
        </div>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2.5 bg-no text-white rounded-lg text-sm font-satoshi font-bold hover:bg-no/90 transition-colors cursor-pointer"
          >
            {t("deleteAccount")}
          </button>
        ) : (
          <div className="space-y-3 border border-no/20 rounded-xl p-4">
            <p className="text-sm text-text">{t("typeDeleteToConfirm", { keyword: "DELETE" })}</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-no focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-satoshi font-bold border border-border-custom text-text hover:bg-elevated transition-colors"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== "DELETE" || deleting}
                className="flex-1 px-4 py-2.5 bg-no text-white rounded-lg text-sm font-satoshi font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? t("deleting") : t("confirmDelete")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Notifications Tab ─── */
function NotificationsTab() {
  // Notification preferences are local-state-only in v1 (no email delivery,
  // no push). All in-app notifications are surfaced through the bell.
  const t = useTranslations("settings");
  const [emailResolutions, setEmailResolutions] = useState(false);
  const [inAppOrderFills, setInAppOrderFills] = useState(true);
  const [hideSmallFills, setHideSmallFills] = useState(true);
  const [inAppResolutions, setInAppResolutions] = useState(true);

  return (
    <div className="space-y-6">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("notificationsSettings")}</h2>

      <div className="border border-border-custom rounded-xl overflow-hidden">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center">
              <Mail className="w-4 h-4 text-muted-custom" />
            </div>
            <span className="text-sm font-satoshi font-medium text-text">{t("emailSection")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text">{t("resolutions")}</span>
            <ToggleSwitch enabled={emailResolutions} onToggle={() => setEmailResolutions(!emailResolutions)} />
          </div>
        </div>

        <div className="border-t border-border-custom" />

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center">
              <BellRing className="w-4 h-4 text-muted-custom" />
            </div>
            <span className="text-sm font-satoshi font-medium text-text">{t("inAppSection")}</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text">{t("orderFills")}</span>
              <ToggleSwitch enabled={inAppOrderFills} onToggle={() => setInAppOrderFills(!inAppOrderFills)} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hideSmallFills}
                onChange={() => setHideSmallFills(!hideSmallFills)}
                className="w-4 h-4 rounded accent-yes cursor-pointer"
              />
              <span className="text-xs text-muted-custom">{t("hideSmallFills")}</span>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-text">{t("resolutions")}</span>
            <ToggleSwitch enabled={inAppResolutions} onToggle={() => setInAppResolutions(!inAppResolutions)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */
function SettingsField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-satoshi font-medium text-text">
        {label}
      </label>
      {children}
    </div>
  );
}
