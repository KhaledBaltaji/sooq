"use client";

// W6 cutover: Supabase Auth -> Auth.js. Branch / referral signup paths
// were stripped in W3 — re-add via fresh spec when growth needs it.

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { PhoneInput } from "./phone-input";
import { OTPInput } from "./otp-input";
import { cn } from "@/lib/utils";
import { ArrowLeft, X, Smartphone } from "lucide-react";

type AuthStep = "welcome" | "phone" | "otp";
type Direction = "forward" | "back";

export function AuthSteps({ onAuthSuccess }: { onAuthSuccess?: () => void } = {}) {
  const [step, setStep] = useState<AuthStep>("welcome");
  const [direction, setDirection] = useState<Direction>("forward");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goTo = (next: AuthStep, dir: Direction = "forward") => {
    setDirection(dir);
    setError(null);
    setStep(next);
  };

  const goBack = () => {
    if (step === "otp") goTo("phone", "back");
    else goTo("welcome", "back");
  };

  // --- WhatsApp OTP flow ---
  const handleSendOTP = async (phoneNumber: string) => {
    setLoading(true);
    setError(null);
    setPhone(phoneNumber);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Failed to send code");
        setLoading(false);
        return;
      }

      setLoading(false);
      goTo("otp");
    } catch {
      setError("Failed to send code. Please try again.");
      setLoading(false);
    }
  };

  const handleVerifyOTP = useCallback(
    async (code: string) => {
      if (!phone) return;
      setLoading(true);
      setError(null);

      // Auth.js signIn with our custom whatsapp-otp Credentials provider.
      // The provider validates the 6-digit code against otp_verifications
      // (SHA-256 hash match), find-or-creates the user by phone, marks the
      // code consumed.
      const result = await signIn("whatsapp-otp", {
        phone,
        code,
        redirect: false,
      });

      if (!result?.ok || result.error) {
        setError(result?.error ?? "Verification failed");
        setLoading(false);
        return;
      }

      // Session cookie is set by Auth.js. Hard reload to pick it up cleanly.
      if (onAuthSuccess) {
        window.location.reload();
      } else {
        window.location.href = "/";
      }
    },
    [phone, onAuthSuccess]
  );

  const handleResendOTP = async () => {
    if (!phone) return;
    setError(null);
    try {
      await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
    } catch {
      // Silent fail on resend — user can try again
    }
  };

  // --- Google OAuth (Auth.js) ---
  const handleGoogleAuth = async () => {
    await signIn("google", { callbackUrl: "/" });
  };

  return (
    <div className="bg-surface rounded-lg p-10 shadow-[0_8px_32px_rgba(0,0,0,0.7)] relative overflow-hidden min-h-[480px]">
      {/* Close button — visible on welcome step when in modal mode */}
      {onAuthSuccess && step === "welcome" && (
        <button
          onClick={onAuthSuccess}
          className="absolute top-4 right-4 text-muted-custom hover:text-text transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-elevated/50 z-10"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {/* Step container with animations */}
      <div className="relative">
        <StepWrapper active={step === "welcome"} direction={direction}>
          <WelcomeStep
            onGoogle={handleGoogleAuth}
            onPhone={() => goTo("phone")}
          />
        </StepWrapper>

        <StepWrapper active={step === "phone"} direction={direction}>
          <PhoneStep
            onBack={goBack}
            onSubmit={handleSendOTP}
            loading={loading}
            error={error}
          />
        </StepWrapper>

        <StepWrapper active={step === "otp"} direction={direction}>
          <OTPStep
            onBack={goBack}
            phone={phone}
            onVerify={handleVerifyOTP}
            onResend={handleResendOTP}
            loading={loading}
            error={error}
          />
        </StepWrapper>
      </div>
    </div>
  );
}

// --- Step animation wrapper ---
function StepWrapper({ active, direction, children }: { active: boolean; direction: Direction; children: React.ReactNode }) {
  if (!active) return null;

  return (
    <div
      className={cn(
        "animate-in duration-200 ease-out fill-mode-both",
        direction === "forward"
          ? "fade-in slide-in-from-right-4"
          : "fade-in slide-in-from-left-4"
      )}
    >
      {children}
    </div>
  );
}

// --- Back button ---
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-0 start-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50"
      aria-label="Go back"
    >
      <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" />
    </button>
  );
}

// --- Logo ---
function SooqLogo({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <div className="flex justify-center mb-8">
      <span className={cn(
        "font-satoshi font-black text-text tracking-tighter",
        size === "lg" ? "text-[28px]" : "text-xl"
      )}>
        sooq
      </span>
    </div>
  );
}

// --- Input component (styled for auth) ---
function AuthInput({
  placeholder,
  value,
  onChange,
  label,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-dm-sans font-medium text-muted-custom uppercase tracking-wider">
          {label}
        </label>
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full h-12 bg-bg border border-border-custom rounded-md px-4 text-text",
          "placeholder:text-dim font-dm-sans text-sm",
          "focus:outline-none focus:border-yes focus:ring-1 focus:ring-yes/30 transition-all"
        )}
      />
    </div>
  );
}

// =============================================
// STEP 1: WELCOME
// =============================================
function WelcomeStep({ onGoogle, onPhone }: {
  onGoogle: () => void;
  onPhone: () => void;
}) {
  const t = useTranslations("auth");
  return (
    <div className="flex flex-col items-center">
      <SooqLogo />
      <div className="text-center mb-8">
        <h1 className="text-[22px] font-medium text-text font-satoshi mb-2">{t("welcomeTitle")}</h1>
        <p className="text-sm text-muted-custom">{t("tradeOnPolitics")}</p>
      </div>

      <div className="w-full space-y-4">
        {/* Google */}
        <button
          onClick={onGoogle}
          className="w-full h-12 border border-border-custom rounded-md flex items-center justify-center gap-2 hover:bg-elevated active:scale-[0.98] transition-all text-sm font-medium"
        >
          <GoogleIcon />
          {t("continueWithGoogle")}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 py-2">
          <div className="flex-1 h-px bg-border-custom" />
          <span className="text-dim text-xs uppercase tracking-widest font-medium">{t("or")}</span>
          <div className="flex-1 h-px bg-border-custom" />
        </div>

        {/* Phone (WhatsApp) */}
        <button
          onClick={onPhone}
          className="w-full h-12 bg-surface border border-border-custom text-text font-bold rounded-md flex items-center justify-center gap-3 transition-colors hover:bg-elevated active:scale-[0.98] text-sm"
        >
          <Smartphone className="w-5 h-5" />
          {t("continueWithPhone")}
        </button>
      </div>

      {/* Legal footer */}
      <p className="mt-8 text-[11px] text-dim text-center leading-relaxed max-w-[280px]">
        {t.rich("termsAndPrivacy", {
          terms: (chunks) => <a href="/terms" className="underline hover:text-text transition-colors">{chunks}</a>,
          privacy: (chunks) => <a href="/privacy" className="underline hover:text-text transition-colors">{chunks}</a>,
        })}
      </p>
    </div>
  );
}

// =============================================
// STEP 2: PHONE
// =============================================
function PhoneStep({ onBack, onSubmit, loading, error }: {
  onBack: () => void;
  onSubmit: (phone: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("auth");

  return (
    <div className="relative">
      <BackButton onClick={onBack} />
      <SooqLogo size="sm" />

      <div className="mb-6">
        <h1 className="text-xl font-medium text-text font-satoshi mb-1">{t("enterPhone")}</h1>
        <p className="text-sm text-muted-custom">{t("wellSendWhatsApp")}</p>
      </div>

      <div className="space-y-6">
        <PhoneInput onSubmit={onSubmit} loading={loading} error={error} />
      </div>

      <p className="mt-8 text-[11px] text-dim text-center leading-relaxed">
        {t.rich("termsAndPrivacy", {
          terms: (chunks) => <a href="/terms" className="underline hover:text-text transition-colors">{chunks}</a>,
          privacy: (chunks) => <a href="/privacy" className="underline hover:text-text transition-colors">{chunks}</a>,
        })}
      </p>
    </div>
  );
}

// =============================================
// STEP 3: OTP VERIFICATION
// =============================================
function OTPStep({ onBack, phone, onVerify, onResend, loading, error }: {
  onBack: () => void;
  phone: string;
  onVerify: (code: string) => void;
  onResend: () => void;
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations("auth");

  return (
    <div className="relative flex flex-col items-center">
      <div className="w-full flex justify-between items-center mb-10">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-muted-custom hover:text-text rtl:scale-x-[-1]" />
        </button>
        <span className="font-satoshi font-black text-yes text-xl tracking-tighter">sooq</span>
        <div className="w-10" />
      </div>

      <div className="text-center mb-8">
        <h1 className="text-xl font-medium text-text font-satoshi mb-2">{t("verifyYourPhone")}</h1>
        <p className="text-sm text-muted-custom">
          {t.rich("enterWhatsAppCode", { phone: () => <span className="text-text font-medium">{phone}</span> })}
        </p>
      </div>

      <OTPInput
        onSubmit={onVerify}
        onResend={onResend}
        loading={loading}
        error={error}
      />
    </div>
  );
}

// --- Helpers ---

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
