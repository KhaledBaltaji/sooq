"use client";

// T6.2: error boundary for auth routes (/login, /verify). Without this a
// render crash in either page bubbles up to global-error.tsx, which is a
// stark full-screen fallback. This boundary keeps the auth layout chrome
// and offers a focused recovery action.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const [, setEventId] = useState<string | null>(null);

  useEffect(() => {
    const id = Sentry.captureException(error);
    setEventId(typeof id === "string" ? id : null);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-md px-md text-center">
      <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-error" />
      </div>
      <h2 className="font-satoshi text-lg font-bold text-text">
        {t("somethingWentWrong")}
      </h2>
      <p className="text-muted text-sm max-w-sm">
        {error.message || t("unexpectedError")}
      </p>
      <Button onClick={reset} className="bg-yes hover:bg-yes/90 text-white">
        {t("tryAgain")}
      </Button>
    </div>
  );
}
