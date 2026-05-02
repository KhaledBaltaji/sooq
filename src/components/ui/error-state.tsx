"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title,
  description,
  onRetry,
}: ErrorStateProps) {
  const t = useTranslations("errors");
  const displayTitle = title || t("somethingWentWrong");
  const displayDesc = description || t("couldntLoad");

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-no/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-no" />
      </div>
      <h3 className="text-md font-medium text-text mb-1">{displayTitle}</h3>
      <p className="text-sm text-muted-custom max-w-[280px]">{displayDesc}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 bg-elevated text-text text-sm font-medium rounded-lg transition-colors hover:bg-border-custom flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t("tryAgain")}
        </button>
      )}
    </div>
  );
}
