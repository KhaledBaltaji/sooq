"use client";

import { useTranslations } from "next-intl";
import { BarChart3, Banknote, ShieldCheck } from "lucide-react";

export function BottomSections() {
  const t = useTranslations("home");

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-12 border-t border-border-custom">
      {/* How Sooq Works */}
      <div>
        <h2 className="font-satoshi text-xl font-medium mb-6">{t("howSooqWorks")}</h2>
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-yes/10 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-yes" />
            </div>
            <div>
              <h4 className="font-medium text-sm mb-1">{t("informationMarkets")}</h4>
              <p className="text-sm text-muted-custom leading-relaxed">
                {t("informationMarketsDesc")}
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-yes/10 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-5 h-5 text-yes" />
            </div>
            <div>
              <h4 className="font-medium text-sm mb-1">{t("instantLiquidity")}</h4>
              <p className="text-sm text-muted-custom leading-relaxed">
                {t("instantLiquidityDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trust & Resolution */}
      <div>
        <h2 className="font-satoshi text-xl font-medium mb-6">{t("trustResolution")}</h2>
        <div className="bg-surface p-6 rounded-xl border border-border-custom">
          <p className="text-sm text-muted-custom leading-relaxed mb-6">
            {t("trustResolutionDesc")}
          </p>
          <ul className="space-y-3">
            <li className="flex items-center gap-2 text-xs font-medium text-text">
              <ShieldCheck className="w-4 h-4 text-success flex-shrink-0" />
              {t("verifiedSources")}
            </li>
            <li className="flex items-center gap-2 text-xs font-medium text-text">
              <ShieldCheck className="w-4 h-4 text-success flex-shrink-0" />
              {t("auditedContracts")}
            </li>
            <li className="flex items-center gap-2 text-xs font-medium text-text">
              <ShieldCheck className="w-4 h-4 text-success flex-shrink-0" />
              {t("marketSurveillance")}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
