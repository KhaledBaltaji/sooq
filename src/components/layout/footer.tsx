"use client";

// W7: footer slimmed. LMSR market categories dropped (politics/economy/
// sports/tech/entertainment) along with the /markets, /help, /agents
// routes that were stripped in W2/W4. Re-add categories if Sooq Speed
// expands beyond BTC.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Globe, ExternalLink } from "lucide-react";

const FOOTER_LINKS = [
  { key: "terms", href: "/terms" },
  { key: "privacy", href: "/privacy" },
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="flex items-center gap-0 font-satoshi text-text font-black text-2xl tracking-tighter">
              sooq
            </span>
            <p className="text-muted-custom text-sm mt-2">{t("tagline")}</p>
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
            <ul className="space-y-2">
              {SOCIAL_LINKS.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-custom hover:text-text text-sm transition-colors inline-flex items-center gap-1.5 py-1"
                  >
                    <s.icon className="w-3.5 h-3.5" />
                    {t(s.key)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border-custom/50 text-xs text-muted-custom">
          © {new Date().getFullYear()} Sooq. {t("rights")}
        </div>
      </div>
    </footer>
  );
}
