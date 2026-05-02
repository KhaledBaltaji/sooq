"use client";

import { useTranslations } from "next-intl";

const categoryConfig: Record<
  string,
  { labelKey: string; className: string }
> = {
  economy: { labelKey: "economy", className: "bg-yes/15 text-yes" },
  politics: { labelKey: "politics", className: "bg-[var(--warning,#F59E0B)]/15 text-[var(--warning,#F59E0B)]" },
  sports: { labelKey: "sports", className: "bg-success/15 text-success" },
  culture: { labelKey: "culture", className: "bg-no/15 text-no" },
  weather: { labelKey: "weather", className: "bg-[var(--info,#38BDF8)]/15 text-[var(--info,#38BDF8)]" },
};

export function CategoryBadge({ category }: { category: string }) {
  const t = useTranslations("prelaunch");
  const config = categoryConfig[category] || categoryConfig.economy;

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${config.className}`}
    >
      {t(config.labelKey)}
    </span>
  );
}
