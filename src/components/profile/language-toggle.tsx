"use client";

import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

export function LanguageToggle() {
  const locale = useLocale();

  const setLocale = (newLocale: string) => {
    document.cookie = `locale=${newLocale};path=/;max-age=31536000`;
    window.location.reload();
  };

  return (
    <div className="inline-flex rounded-lg bg-elevated p-1 gap-1">
      <button
        onClick={() => setLocale("en")}
        className={cn(
          "px-4 py-2 rounded-md text-sm font-satoshi font-bold transition-all cursor-pointer",
          locale === "en"
            ? "bg-yes text-white shadow-sm"
            : "text-muted-custom hover:text-text hover:bg-surface"
        )}
      >
        English
      </button>
      <button
        onClick={() => setLocale("ar")}
        className={cn(
          "px-4 py-2 rounded-md text-sm font-noto-arabic font-bold transition-all cursor-pointer",
          locale === "ar"
            ? "bg-yes text-white shadow-sm"
            : "text-muted-custom hover:text-text hover:bg-surface"
        )}
      >
        العربية
      </button>
    </div>
  );
}
