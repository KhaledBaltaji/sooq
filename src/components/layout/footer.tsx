"use client";

// W10: full port of the prediction-market 4-column footer. The W7 slim
// version dropped Markets/Help columns + had a broken t("rights") call
// (the actual i18n key is "copyright" with a {year} placeholder).
// Sooq is speed-only-on-BTC for v1; the Markets column lists the three
// durations rather than LMSR categories.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Globe, ExternalLink } from "lucide-react";

const MARKET_LINKS = [
  { label: "Bitcoin 5m", href: "/markets?duration=5m" },
  { label: "Bitcoin 15m", href: "/markets?duration=15m" },
  { label: "Bitcoin 24h", href: "/markets?duration=24h" },
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
      className="border-t border-border-custom bg-surface pb-20 lg:pb-0"
      style={{ touchAction: "manipulation" }}
    >
      <div className="max-w-[1240px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        {/* Top section — 4 columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="flex items-center gap-0 font-satoshi text-text font-black text-2xl tracking-tighter">
              sooq
            </span>
            <p className="text-muted-custom text-sm mt-2">{t("tagline")}</p>
          </div>

          {/* Markets */}
          <div>
            <h3 className="text-text font-semibold text-sm mb-3">
              {t("markets")}
            </h3>
            <ul className="space-y-2">
              {MARKET_LINKS.map((m) => (
                <li key={m.label}>
                  <Link
                    href={m.href}
                    className="text-muted-custom hover:text-text text-sm transition-colors inline-block py-1"
                  >
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-text font-semibold text-sm mb-3">
              {t("links")}
            </h3>
            <ul className="space-y-2">
              {FOOTER_LINKS.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-muted-custom hover:text-text text-sm transition-colors inline-block py-1"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="text-text font-semibold text-sm mb-3">
              {t("social")}
            </h3>
            <div className="flex gap-3">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(s.key)}
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-dim hover:text-muted-custom hover:bg-elevated transition-colors [-webkit-tap-highlight-color:transparent]"
                >
                  <s.icon className="w-5 h-5" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom section — disclaimer + copyright */}
        <div className="border-t border-border-custom mt-8 pt-6 space-y-2">
          <p className="text-dim text-xs leading-relaxed">{t("disclaimer")}</p>
          <p className="text-dim text-xs">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
