"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    Sentry.captureException(error);
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
      <Button
        onClick={reset}
        className="bg-yes hover:bg-yes/90 text-white"
      >
        {t("tryAgain")}
      </Button>
    </div>
  );
}
