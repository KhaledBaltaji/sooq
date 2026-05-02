"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { DemoResetButton } from "@/components/demo/DemoResetButton";
import { BalanceChip } from "@/components/layout/balance-chip";

export default function DemoSettingsPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const t = useTranslations("demo");

  const handleExit = async () => {
    // Turn off the preference (balance + positions preserved) and navigate home.
    await supabase.rpc("toggle_demo_mode" as never, { p_enabled: false } as never);
    router.push("/");
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-satoshi font-black text-2xl text-text">
          {t("settings.title")}
        </h1>
        <BalanceChip />
      </div>

      {/* Reset */}
      <section className="space-y-2">
        <h2 className="text-sm font-satoshi font-bold text-text">
          {t("settings.resetSection")}
        </h2>
        <p className="text-xs text-muted-custom">{t("settings.resetDescription")}</p>
        <DemoResetButton />
      </section>

      {/* Exit */}
      <section className="space-y-2">
        <h2 className="text-sm font-satoshi font-bold text-text">
          {t("settings.exitSection")}
        </h2>
        <p className="text-xs text-muted-custom">{t("settings.exitDescription")}</p>
        <button
          type="button"
          onClick={handleExit}
          className="inline-flex items-center gap-2 rounded-lg border border-border-custom bg-surface px-4 py-2.5 text-sm font-satoshi font-bold text-text hover:bg-elevated transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {t("settings.exitButton")}
        </button>
      </section>
    </div>
  );
}
