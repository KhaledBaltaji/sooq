"use client";

import { usePathname } from "next/navigation";
import { Footer } from "./footer";

/**
 * Hides the site <Footer /> on focus routes (portfolio, transactions, market
 * detail) on mobile. Desktop keeps the footer for SEO + quick links, because
 * the vertical real estate isn't at a premium there.
 *
 * Mirrors the BottomNavGate pattern so the parent (app)/layout.tsx stays a
 * server component.
 */
const HIDE_ON_MOBILE_PATTERNS = [
  /^\/trade(\/|$)/,
  /^\/transactions(\/|$)/,
  /^\/market\//,
  /^\/m\//,
  /^\/speed\//,  // speed detail pages — own fixed-bottom trade bar
];

export function FooterGate() {
  const pathname = usePathname();
  const hideOnMobile = HIDE_ON_MOBILE_PATTERNS.some((re) => re.test(pathname));

  if (hideOnMobile) {
    return (
      <div className="hidden lg:block">
        <Footer />
      </div>
    );
  }
  return <Footer />;
}
