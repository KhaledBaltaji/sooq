"use client";

import type { LucideIcon } from "lucide-react";
import { Lock } from "lucide-react";
import { useAuthModal } from "./auth-modal-provider";

interface SignInPromptProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  signInLabel?: string;
  createAccountLabel?: string;
}

/**
 * Reusable sign-in prompt for anonymous users on gated (app) routes.
 * Renders an icon + headline + short description + two CTAs. Both CTAs
 * open the shared login modal — the unified auth flow handles both
 * existing-user sign-in and new-user account creation.
 */
export function SignInPrompt({
  icon: Icon = Lock,
  title,
  description,
  signInLabel = "Sign in",
  createAccountLabel = "Create account",
}: SignInPromptProps) {
  const { openLoginModal } = useAuthModal();

  return (
    <div className="px-6 py-16 flex flex-col items-center text-center max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-full bg-elevated flex items-center justify-center mb-5">
        <Icon className="w-6 h-6 text-muted-custom" />
      </div>

      <h2 className="text-lg font-satoshi font-bold text-text mb-2">
        {title}
      </h2>

      {description && (
        <p className="text-sm text-muted-custom font-dm-sans leading-relaxed mb-8">
          {description}
        </p>
      )}

      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={openLoginModal}
          className="w-full h-12 rounded-md bg-yes text-white text-sm font-satoshi font-bold cursor-pointer hover:brightness-110 transition-all"
        >
          {signInLabel}
        </button>
        <button
          type="button"
          onClick={openLoginModal}
          className="w-full h-12 rounded-md bg-surface border border-border-custom text-text text-sm font-satoshi font-bold cursor-pointer hover:bg-elevated transition-colors"
        >
          {createAccountLabel}
        </button>
      </div>
    </div>
  );
}
