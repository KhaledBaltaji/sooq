"use client";

// W10: full port of the prediction-market 4-column footer. The W7 slim
// version dropped Markets/Help columns + had a broken t("rights") call
// (the actual i18n key is "copyright" with a {year} placeholder).
// Sooq is speed-only-on-BTC for v1; the Markets column lists the active
// durations (mig 369: 15m and 24h removed; only 5m + 1h create new rounds).

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Globe, ExternalLink } from "lucide-react";

const MARKET_LINKS = [
  { label: "Bitcoin 5m", href: "/markets?duration=5m" },
  { label: "Bitcoin 1h", href: "/markets?duration=1h" },
] as const;

const FOOTER_LINKS = [
  { key: "terms", href: "/terms" },
  { key: "privacy", href: "/privacy" },
  { key: "help", href: "/help" },
] as const;

const SOCIAL_LINKS = [
  { key: "twitter", href: "https://x.com", icon: Globe },
  { key: "instagram", href: "https://instagram.com/sooq.exchange", icon: ExternalLink },
] as const;

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer
      className="mt-20 border-t border-border-custom pb-20 lg:pb-0"
      style={{ touchAction: "manipulation" }}
    >
      <div className="max-w-[1240px] mx-auto px-4 lg:px-8 pt-10 pb-6">
        {/* Top section — 4 columns, editorial */}
        <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr] gap-x-12 gap-y-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="flex items-center gap-0 font-satoshi text-text font-black text-2xl tracking-tighter">
              sooq
            </span>
            <p className="text-muted-custom text-sm leading-relaxed mt-4 font-dm-sans max-w-[340px]">
              {t("tagline")}
            </p>
          </div>

          {/* Markets */}
          <div>
            <h3 className="font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom mb-4">
              {t("markets")}
            </h3>
            <ul className="space-y-2.5">
              {MARKET_LINKS.map((m) => (
                <li key={m.label}>
                  <Link
                    href={m.href}
                    className="font-dm-sans text-text text-sm transition-colors hover:text-muted-custom"
                  >
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom mb-4">
              {t("links")}
            </h3>
            <ul className="space-y-2.5">
              {FOOTER_LINKS.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="font-dm-sans text-text text-sm transition-colors hover:text-muted-custom"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="font-satoshi text-[11px] font-bold uppercase tracking-[0.22em] text-muted-custom mb-4">
              {t("social")}
            </h3>
            <div className="flex gap-2">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(s.key)}
                  className="w-9 h-9 flex items-center justify-center rounded-full text-muted-custom hover:text-text hover:bg-elevated transition-colors [-webkit-tap-highlight-color:transparent]"
                >
                  <s.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom section — disclaimer + copyright */}
        <div className="mt-12 pt-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="font-dm-sans text-muted-custom text-xs leading-relaxed max-w-[680px]">
            {t("disclaimer")}
          </p>
          <p className="font-dm-sans text-muted-custom text-xs whitespace-nowrap">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
