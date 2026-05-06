"use client";

// Fixed banner at the top of the viewport when navigator.onLine flips
// false. Listens for `online` / `offline` events to update reactively.
// Does not assume online state on first render — initial value comes
// from `navigator.onLine` itself, which is always defined in the
// browser. T3.6.
//
// Mounted once at the app layout level so it covers every route.

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

export function OfflineBanner() {
  const t = useTranslations("common");
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    // SSR-safe initial sync: only read navigator after mount.
    if (typeof navigator !== "undefined" && "onLine" in navigator) {
      setOnline(navigator.onLine);
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[60] bg-warning text-warning-foreground py-2 px-4 text-center text-sm font-bold shadow-md"
    >
      <span className="inline-flex items-center gap-2">
        <WifiOff className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        {t("offlineBanner")}
      </span>
    </div>
  );
}
