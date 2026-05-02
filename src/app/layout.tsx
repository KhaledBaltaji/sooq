import type { Viewport } from "next";
import Script from "next/script";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { User as ApiUser } from "@/types/user";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { satoshi, dmSans, notoSansArabic, geist, geistMono } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { MaterialSymbols } from "@/components/material-symbols";
import { LanguageSelectorModal } from "@/components/locale/language-selector-modal";
import "./globals.css";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: t("siteTitle"),
    description: t("siteDescription"),
    applicationName: "Sooq",
    icons: {
      icon: "/favicon.png",
      apple: "/icons/pwa/apple-touch-icon-180.png",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default" as const,
      title: "Sooq",
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0B0E" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  // Prefetch session + user profile server-side. Profile is shaped to
  // match the snake_case JSON returned by /api/users/me.
  const session = await auth();
  let initialProfile: ApiUser | null = null;
  if (session?.user?.id) {
    try {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);
      const u = rows[0];
      if (u) {
        initialProfile = {
          id: u.id,
          name: u.name,
          email: u.email,
          email_verified: u.emailVerified ? u.emailVerified.toISOString() : null,
          image: u.image,
          phone: u.phone,
          display_name: u.displayName,
          avatar_url: u.avatarUrl,
          bio: u.bio,
          locale: u.locale,
          balance_usd: Number(u.balanceUsd),
          is_admin: u.isAdmin,
          is_frozen: u.isFrozen,
          admin_allowed_views: u.adminAllowedViews,
          created_at: u.createdAt.toISOString(),
          updated_at: u.updatedAt.toISOString(),
        };
      }
    } catch {
      // Profile prefetch failed — UserProvider will retry client-side.
    }
  }

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        {/* Theme bootstrap — runs synchronously in <head> before paint to
            avoid FOUC. Removed the /shu-rayak prelaunch override (route
            stripped in W2). Uses Script with beforeInteractive strategy
            to satisfy React 19's "no inline <script> in components" rule
            while still loading early. */}
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
        >{`(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark')}else if(t==='system'){var d=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',d)}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){}})()`}</Script>
      </head>
      <body
        className={`${satoshi.variable} ${dmSans.variable} ${notoSansArabic.variable} ${geist.variable} ${geistMono.variable} antialiased`}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-yes focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
        >
          Skip to content
        </a>
        <MaterialSymbols />
        <Providers locale={locale} messages={messages as Record<string, unknown>} session={session} initialProfile={initialProfile}>
          <LanguageSelectorModal />
          {children}
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
