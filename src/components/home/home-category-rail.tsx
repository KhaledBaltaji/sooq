"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, triggerHapticLight } from "@/lib/utils";

export const HOME_CATEGORIES = [
  "all",
  "speed",
  "politics",
  "economy",
  "sports",
  "tech",
  "entertainment",
] as const;

export type HomeCategory = (typeof HOME_CATEGORIES)[number];

const COMPACT_AT = 80; // px scrolled before rail compacts

export function HomeCategoryRail({
  active,
  onChange,
}: {
  active: HomeCategory;
  onChange: (c: HomeCategory) => void;
}) {
  const t = useTranslations("markets");
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setCompact(window.scrollY > COMPACT_AT);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      role="tablist"
      aria-label={t("title")}
      data-compact={compact || undefined}
      className="lg:hidden sticky z-40 bg-bg/95 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80 border-b border-border-custom -mx-4 px-4 transition-[box-shadow,backdrop-filter] data-[compact]:shadow-[0_1px_8px_rgba(0,0,0,0.04)]"
      style={{ top: "calc(4rem + env(safe-area-inset-top))" }}
    >
      <div
        className={cn(
          "flex items-center overflow-x-auto hide-scrollbar [-webkit-overflow-scrolling:touch] transition-[height,gap] duration-200 ease-out",
          compact ? "h-8 gap-3" : "h-12 gap-4",
        )}
      >
        {HOME_CATEGORIES.map((cat) => {
          const isActive = cat === active;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                triggerHapticLight();
                onChange(cat);
                if (typeof window === "undefined") return;
                // Native smooth scroll — works on iOS Safari + Android Chrome
                // (where the user actually is).
                window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                // Safety net — if the browser ignored the smooth scroll
                // (rare; some Chromium-internal contexts no-op smooth on
                // sticky parents), snap to top after the animation window
                // would have ended. Real users on real browsers never see
                // this fallback fire.
                window.setTimeout(() => {
                  if ((window.scrollY || document.documentElement.scrollTop) > 4) {
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                  }
                }, 380);
              }}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap font-satoshi transition-[font-size,color] duration-200 [-webkit-tap-highlight-color:transparent]",
                compact ? "text-[11px]" : "text-sm",
                isActive
                  ? "font-black text-text"
                  : "font-medium text-muted-custom hover:text-text",
              )}
            >
              {isActive && cat === "all" && !compact && (
                <TrendingUp className="w-3.5 h-3.5" strokeWidth={2.5} />
              )}
              {t(cat)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
