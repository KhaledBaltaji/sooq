"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { HowItWorksDialog } from "./how-it-works";

const STORAGE_KEY = "how-it-works-banner-dismissed";

export function HowItWorksBanner() {
  const t = useTranslations("home");
  // Default dismissed=true to avoid SSR/first-paint flash; flip after reading storage
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY) !== "true") {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    setDismissed(true);
  };

  if (dismissed) {
    return <HowItWorksDialog open={open} onOpenChange={setOpen} />;
  }

  return (
    <>
      <div
        role="region"
        aria-label={t("howItWorks")}
        className="fixed left-0 right-0 z-40 lg:hidden bg-surface border-t border-border-custom pb-safe"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 h-11">
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("dismiss")}
            className="inline-flex items-center justify-center h-8 w-8 -ml-2 rounded-full text-muted-custom hover:text-text active:scale-95 transition-all [-webkit-tap-highlight-color:transparent]"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-satoshi font-bold text-sm text-yes hover:opacity-80 active:scale-95 transition-all [-webkit-tap-highlight-color:transparent]"
          >
            {t("howItWorks")}
          </button>
        </div>
      </div>
      <HowItWorksDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
