"use client";

import { type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "./theme-provider";
import { SupabaseProvider } from "./supabase-provider";
import { UserProvider } from "./user-provider";
import { AuthModalProvider } from "@/components/auth/auth-modal-provider";
import { DepositModalProvider } from "@/components/wallet/deposit-modal-provider";
import { WithdrawModalProvider } from "@/components/wallet/withdraw-modal-provider";
import { QueryProvider } from "@/lib/query/provider";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeStatus } from "@/components/ui/realtime-status";

interface ProvidersProps {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
  initialAuthUser: import("@supabase/supabase-js").User | null;
  initialProfile: import("@/types/user").User | null;
}

export function Providers({ children, locale, messages, initialAuthUser, initialProfile }: ProvidersProps) {
  const isRtl = locale === "ar";
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        <SupabaseProvider>
          <UserProvider initialAuthUser={initialAuthUser} initialProfile={initialProfile}>
          <QueryProvider>
          <AuthModalProvider>
            <DepositModalProvider>
              <WithdrawModalProvider>
                {children}
                <RealtimeStatus />
                <Toaster position={isRtl ? "top-left" : "top-right"} dir={isRtl ? "rtl" : "ltr"} />
              </WithdrawModalProvider>
            </DepositModalProvider>
          </AuthModalProvider>
          </QueryProvider>
          </UserProvider>
        </SupabaseProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
