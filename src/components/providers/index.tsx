"use client";

// Client-side provider tree.
// W7 cutover: Supabase -> Auth.js. SessionProvider replaces SupabaseProvider.

import { type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { ThemeProvider } from "./theme-provider";
import { SupabaseProvider } from "./supabase-provider";
import { UserProvider } from "./user-provider";
import { AuthModalProvider } from "@/components/auth/auth-modal-provider";
import { DepositModalProvider } from "@/components/wallet/deposit-modal-provider";
import { WithdrawModalProvider } from "@/components/wallet/withdraw-modal-provider";
import { QueryProvider } from "@/lib/query/provider";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeStatus } from "@/components/ui/realtime-status";
import type { User } from "@/types/user";

interface ProvidersProps {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
  session: Session | null;
  initialProfile: User | null;
}

export function Providers({
  children,
  locale,
  messages,
  session,
  initialProfile,
}: ProvidersProps) {
  const isRtl = locale === "ar";
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        <SessionProvider session={session}>
          {/* SupabaseProvider stays during W7 hybrid state — many
              components still call useSupabase() for non-auth queries.
              They get cut over to Drizzle progressively. */}
          <SupabaseProvider>
            <UserProvider initialProfile={initialProfile}>
              <QueryProvider>
                <AuthModalProvider>
                  <DepositModalProvider>
                    <WithdrawModalProvider>
                      {children}
                      <RealtimeStatus />
                      <Toaster
                        position={isRtl ? "top-left" : "top-right"}
                        dir={isRtl ? "rtl" : "ltr"}
                      />
                    </WithdrawModalProvider>
                  </DepositModalProvider>
                </AuthModalProvider>
              </QueryProvider>
            </UserProvider>
          </SupabaseProvider>
        </SessionProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
