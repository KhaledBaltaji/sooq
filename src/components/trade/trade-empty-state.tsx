"use client";

import Link from "next/link";
import { TrendingUp, Landmark, Trophy, Cpu, Banknote, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkets } from "@/hooks/use-markets";

const CATEGORY_ICON: Record<string, typeof TrendingUp> = {
  politics: Landmark,
  sports: Trophy,
  tech: Cpu,
  finance: Banknote,
  economy: Banknote,
  entertainment: Globe,
  general: Globe,
};

interface TradeEmptyStateProps {
  isDemo: boolean;
  locale: string;
}

export function TradeEmptyState({ isDemo, locale }: TradeEmptyStateProps) {
  const { markets } = useMarkets("open");
  const trending = markets.slice(0, 2);
  const marketHrefPrefix = isDemo ? "/demo/market" : "/market";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-surface border border-border-custom px-5 py-8 text-center">
        <div
          className="pointer-events-none absolute left-1/2 -top-10 w-[220px] h-[140px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(120px 80px at 50% 80%, color-mix(in srgb, var(--color-yes) 18%, transparent), transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 bg-[color-mix(in_srgb,var(--color-yes)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-yes)_30%,transparent)] text-yes flex items-center justify-center">
            <TrendingUp className="w-7 h-7" />
          </div>
          <h2 className="font-satoshi font-black text-[20px] text-text mb-1.5">
            Your first trade is waiting
          </h2>
          <p className="mx-auto max-w-[280px] text-[14px] leading-relaxed text-muted-custom mb-5">
            Back what you believe in. Pick a market, place a side, earn when you&rsquo;re right.
          </p>
          <Link
            href={isDemo ? "/demo/markets" : "/"}
            className="btn-3d-yes inline-flex items-center justify-center text-[14px] px-5 py-3"
          >
            Browse markets
          </Link>
          <div className="mt-3 text-[12px] text-muted-custom">
            or{" "}
            <Link href="/wallet" className="text-yes hover:underline cursor-pointer">
              deposit more cash
            </Link>
          </div>
        </div>
      </div>

      {trending.length > 0 && (
        <>
          <div className="flex justify-between items-center px-1">
            <div className="font-satoshi font-bold text-[16px] text-text">Trending now</div>
            <Link
              href={isDemo ? "/demo/markets" : "/markets"}
              className="text-[13px] text-muted-custom hover:text-text transition-colors"
            >
              See all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {trending.map((m) => {
              const yesPct = Math.round(((m.amm_state?.current_yes_price ?? 0.5) * 100));
              const Icon = CATEGORY_ICON[m.category?.toLowerCase() || "general"] || Globe;
              const question =
                locale === "ar"
                  ? m.question_ar || m.question_en
                  : m.question_en || m.question_ar;
              return (
                <Link
                  key={m.id}
                  href={`${marketHrefPrefix}/${m.id}`}
                  className="rounded-xl bg-surface border border-border-custom px-3.5 py-3 flex items-center gap-3 active:opacity-80 transition-opacity"
                >
                  <div className="w-9 h-9 rounded-lg bg-[color-mix(in_srgb,var(--color-yes)_15%,transparent)] text-yes flex items-center justify-center shrink-0">
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "font-satoshi font-bold text-[15px] text-text truncate"
                      )}
                      dir={locale === "ar" ? "rtl" : "ltr"}
                    >
                      {question}
                    </p>
                    <p className="text-[12px] text-muted-custom mt-0.5 capitalize">
                      {m.category}
                    </p>
                  </div>
                  <div className="font-satoshi font-black text-[20px] text-yes tabular-nums shrink-0">
                    {yesPct}
                    <span className="text-[12px] opacity-50 ml-0.5">%</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
