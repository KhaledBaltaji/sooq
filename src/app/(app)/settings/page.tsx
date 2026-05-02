"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useUser } from "@/lib/auth/hooks";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useTheme } from "@/components/providers/theme-provider";
import { useTranslations } from "next-intl";
import { LanguageToggle } from "@/components/profile/language-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/lib/auth/actions";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User as UserIcon,
  Shield,
  Bell,
  ArrowLeft,
  LogOut,
  AlertCircle,
  Mail,
  BellRing,
  Check,
  Sparkles,
} from "lucide-react";

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
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/profile"
          className="p-2 rounded-lg text-muted-custom hover:text-text hover:bg-surface transition-colors"
        >
          <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" />
        </Link>
        <h1 className="font-satoshi font-black text-xl text-text">{t("title")}</h1>
      </div>

      {/* Layout: sidebar tabs + content */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Left tabs */}
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

        {/* Right content — fade animation via key */}
        <div
          key={activeTab}
          className="animate-in fade-in duration-200"
        >
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
  user: any;
  email: string;
}) {
  const supabase = useSupabase();
  const { refetch } = useUser();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [name, setName] = useState(displayName);
  const [userEmail, setUserEmail] = useState(user.email || email || "");
  const [bio, setBio] = useState(user.bio || "");
  const [referralCode, setReferralCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [referralStatus, setReferralStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [applyingReferral, setApplyingReferral] = useState(false);
  const initialLoadRef = useRef(true);

  // Check if within 24 hours of account creation
  const accountAge = user.created_at
    ? Date.now() - new Date(user.created_at).getTime()
    : Infinity;
  const canApplyReferral = !user.referred_by && accountAge < 24 * 60 * 60 * 1000;

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);

    const updates: { display_name: string; bio: string | null; email?: string } = {
      display_name: name.trim(),
      bio: bio.trim() || null,
    };

    // If email changed, update both auth and users table
    const trimmedEmail = userEmail.trim();
    if (trimmedEmail && trimmedEmail !== (user.email || email)) {
      updates.email = trimmedEmail;
      await supabase.auth.updateUser({ email: trimmedEmail });
    }

    await supabase.from("users").update(updates).eq("id", user.id);
    setSaving(false);
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2000);
  }, [name, userEmail, bio, user.id, user.email, email, supabase, refetch]);

  // Auto-save with debounce when name, email, or bio changes
  useEffect(() => {
    // Skip auto-save on initial mount
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      handleSave();
    }, 800);
    return () => clearTimeout(timer);
  }, [name, userEmail, bio, handleSave]);

  const handleApplyReferral = async () => {
    if (!referralCode.trim() || !canApplyReferral) return;
    setApplyingReferral(true);
    setReferralStatus(null);

    // Find referrer by code
    const { data: referrer } = await supabase
      .from("users")
      .select("id")
      .eq("referral_code", referralCode.trim())
      .single();

    if (!referrer) {
      setReferralStatus({ type: "error", message: t("invalidReferralCode") });
      setApplyingReferral(false);
      return;
    }

    if (referrer.id === user.id) {
      setReferralStatus({ type: "error", message: t("cannotUseOwnReferral") });
      setApplyingReferral(false);
      return;
    }

    const { error } = await supabase
      .from("users")
      .update({ referred_by: referrer.id })
      .eq("id", user.id);

    if (error) {
      setReferralStatus({ type: "error", message: t("failedToApplyReferral") });
    } else {
      setReferralStatus({ type: "success", message: t("referralApplied") });
      refetch();
    }
    setApplyingReferral(false);
  };

  return (
    <div className="space-y-6">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("profileSettings")}</h2>

      {/* Avatar */}
      <Avatar name={user.display_name || "User"} userId={user.id} src={user.avatar_url} size="xl" />

      {/* Username */}
      <SettingsField label={t("username")}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none transition-colors"
        />
      </SettingsField>

      {/* Email — hidden for phone users with synthetic emails */}
      {!email.endsWith("@phone.sooq.exchange") && (
        <SettingsField label={t("email")}>
          <input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-full px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none transition-colors"
          />
          {!userEmail && (
            <p className="text-[11px] text-muted-custom mt-1">{t("addEmailForRecovery")}</p>
          )}
        </SettingsField>
      )}

      {/* Bio */}
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

      {/* Referral Code */}
      <SettingsField label={t("referralCode")}>
        {user.referred_by ? (
          <div className="flex items-center gap-2 text-sm text-success">
            <Check className="w-4 h-4" />
            {t("referralAlreadyApplied")}
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={referralCode}
                onChange={(e) => { setReferralCode(e.target.value); setReferralStatus(null); }}
                placeholder={t("referralPlaceholder")}
                disabled={!canApplyReferral}
                className="flex-1 px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleApplyReferral}
                disabled={!referralCode.trim() || !canApplyReferral || applyingReferral}
                className="px-4 py-2.5 rounded-lg text-sm font-satoshi font-bold border border-border-custom text-text hover:bg-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applyingReferral ? "..." : tc("apply")}
              </button>
            </div>
            {referralStatus && (
              <p className={cn("text-xs mt-1", referralStatus.type === "error" ? "text-no" : "text-success")}>
                {referralStatus.message}
              </p>
            )}
            {!canApplyReferral && !user.referred_by && (
              <p className="text-[11px] text-no mt-1">
                {t("referralExpired")}
              </p>
            )}
            {canApplyReferral && (
              <p className="text-[11px] text-muted-custom mt-1">
                {t("referralHint")}
              </p>
            )}
          </>
        )}
      </SettingsField>

      {/* Language */}
      <SettingsField label={t("language")}>
        <LanguageToggle />
      </SettingsField>

      {/* Auto-save indicator */}
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
  const supabase = useSupabase();
  const { user, authUser } = useUser();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [twoFA, setTwoFA] = useState(false);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFAError, setTwoFAError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Check current MFA status on mount
  useState(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (data?.totp && data.totp.length > 0) {
        const verified = data.totp.some((f) => f.status === "verified");
        setTwoFA(verified);
      }
    })();
  });

  const handleToggle2FA = async () => {
    if (twoFA) {
      // Unenroll
      setTwoFALoading(true);
      setTwoFAError(null);
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const activeFactor = factors?.totp?.find((f) => f.status === "verified");
      if (activeFactor) {
        const { error } = await supabase.auth.mfa.unenroll({ factorId: activeFactor.id });
        if (error) {
          setTwoFAError(error.message);
        } else {
          setTwoFA(false);
          setQrCode(null);
          setTotpSecret(null);
        }
      }
      setTwoFALoading(false);
    } else {
      // Enroll — show QR code
      setTwoFALoading(true);
      setTwoFAError(null);
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) {
        setTwoFAError(error.message);
        setTwoFALoading(false);
        return;
      }
      if (data) {
        setQrCode(data.totp.qr_code);
        setTotpSecret(data.totp.secret);
      }
      setTwoFALoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (!verifyCode.trim() || !totpSecret) return;
    setTwoFALoading(true);
    setTwoFAError(null);

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const unverifiedFactor = factors?.all?.find((f) => f.factor_type === "totp" && f.status === "unverified");
    if (!unverifiedFactor) {
      setTwoFAError(t("noPending2FA"));
      setTwoFALoading(false);
      return;
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: unverifiedFactor.id,
    });
    if (challengeError) {
      setTwoFAError(challengeError.message);
      setTwoFALoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: unverifiedFactor.id,
      challengeId: challenge.id,
      code: verifyCode,
    });

    if (verifyError) {
      setTwoFAError(t("invalidCode"));
    } else {
      setTwoFA(true);
      setQrCode(null);
      setTotpSecret(null);
      setVerifyCode("");
    }
    setTwoFALoading(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE" || !user) return;
    setDeleting(true);

    // Soft-delete: freeze account and clear PII
    await supabase.from("users").update({
      is_frozen: true,
      display_name: "[deleted]",
      bio: null,
      email: null,
      avatar_url: null,
    }).eq("id", user.id);

    // Sign out
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="space-y-8">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("accountSettings")}</h2>

      {/* Two-Factor Authentication */}
      <div className="space-y-3">
        <h3 className="font-satoshi font-medium text-base text-text">{t("twoFactorAuth")}</h3>
        <div className="border border-border-custom rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-satoshi font-medium text-text">{t("enable2FA")}</p>
              <p className="text-xs text-muted-custom mt-0.5">
                {t("twoFADescription")}
              </p>
            </div>
            <ToggleSwitch enabled={twoFA} onToggle={handleToggle2FA} />
          </div>

          {/* QR Code enrollment flow */}
          {qrCode && !twoFA && (
            <div className="mt-4 pt-4 border-t border-border-custom space-y-4">
              <p className="text-sm text-text">{t("scan2FAQrCode")}</p>
              <div className="flex justify-center">
                <img src={qrCode} alt="2FA QR Code" className="w-48 h-48 rounded-lg" />
              </div>
              {totpSecret && (
                <p className="text-xs text-muted-custom text-center">
                  {t("manualEntry")} <code className="text-text bg-elevated px-2 py-0.5 rounded text-[11px] select-all">{totpSecret}</code>
                </p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("enter6DigitCode")}
                  className="flex-1 px-3 py-2.5 bg-bg rounded-lg text-sm text-text font-dm-sans border border-border-custom focus:border-yes focus:outline-none"
                />
                <button
                  onClick={handleVerify2FA}
                  disabled={verifyCode.length !== 6 || twoFALoading}
                  className="px-4 py-2.5 bg-yes text-white rounded-lg text-sm font-satoshi font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {twoFALoading ? "..." : t("verify")}
                </button>
              </div>
            </div>
          )}

          {twoFAError && (
            <p className="text-xs text-no mt-2">{twoFAError}</p>
          )}
        </div>
      </div>

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

      {/* Demo Mode */}
      <DemoModeCard />

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
  const t = useTranslations("settings");
  const [emailResolutions, setEmailResolutions] = useState(false);
  const [inAppOrderFills, setInAppOrderFills] = useState(true);
  const [hideSmallFills, setHideSmallFills] = useState(true);
  const [inAppResolutions, setInAppResolutions] = useState(true);

  return (
    <div className="space-y-6">
      <h2 className="font-satoshi font-medium text-xl text-text">{t("notificationsSettings")}</h2>

      <div className="border border-border-custom rounded-xl overflow-hidden">
        {/* Email section */}
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

        {/* In-app section */}
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center">
              <BellRing className="w-4 h-4 text-muted-custom" />
            </div>
            <span className="text-sm font-satoshi font-medium text-text">{t("inAppSection")}</span>
          </div>

          {/* Order Fills */}
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

          {/* Resolutions */}
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

/* ─── Demo Mode Card ─── */
function DemoModeCard() {
  const router = useRouter();
  const tDemo = useTranslations("demo");

  return (
    <div className="space-y-3">
      <h3 className="font-satoshi font-medium text-base text-text">
        {tDemo("toggleLabel")}
      </h3>
      <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-amber-500/20 p-2 shrink-0">
            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-satoshi font-medium text-text truncate">
              {tDemo("splash.title")}
            </p>
            <p className="text-xs text-muted-custom mt-0.5">
              {tDemo("toggleCaption")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/demo")}
          className="shrink-0 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-satoshi font-bold hover:bg-amber-600 transition-colors cursor-pointer"
        >
          {tDemo("openButton")}
        </button>
      </div>
    </div>
  );
}

