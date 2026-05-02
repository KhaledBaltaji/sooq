import type { Viewport } from "next";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
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

  // Prefetch user profile server-side to eliminate client waterfall
  let initialAuthUser = null;
  let initialProfile = null;
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore.getAll().some((c) => c.name.startsWith("sb-"));
  if (hasAuthCookie) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        initialAuthUser = JSON.parse(JSON.stringify(user));
        const { data } = await supabase.from("users").select("*").eq("id", user.id).single();
        initialProfile = data;
      }
    } catch {
      // Auth fetch failed — continue without prefetched data
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
        {/* Theme bootstrap must be a raw <script> (not next/script) so it
            executes synchronously in <head> before paint and avoids FOUC.
            React 19 logs a dev-only warning about inline scripts in React
            trees; the script still ships in the SSR HTML and runs once per
            document load, which is the required behavior. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(location.pathname==='/shu-rayak'){document.documentElement.setAttribute('data-theme','dark');return}var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark')}else if(t==='system'){var d=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',d)}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){}})()`,
          }}
        />
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
        <Providers locale={locale} messages={messages as Record<string, unknown>} initialAuthUser={initialAuthUser} initialProfile={initialProfile}>
          <LanguageSelectorModal />
          {children}
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
