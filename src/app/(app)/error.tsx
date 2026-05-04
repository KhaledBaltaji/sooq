"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Copy } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const [eventId, setEventId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = Sentry.captureException(error);
    setEventId(typeof id === "string" ? id : null);
  }, [error]);

  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent : "";
  const url =
    typeof window !== "undefined" ? window.location.href : "";

  const diagnostics = [
    `${error.name}: ${error.message || "(no message)"}`,
    `Digest: ${error.digest ?? "(none)"}`,
    `Sentry ID: ${eventId ?? "(pending)"}`,
    `URL: ${url}`,
    `UA: ${userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostics);
      } else {
        const ta = document.createElement("textarea");
        ta.value = diagnostics;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

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
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="text-xs text-muted-custom underline"
      >
        {showDetails ? t("hideDetails") : t("showDetails")}
      </button>
      {showDetails && (
        <div className="w-full max-w-md text-left mt-1">
          <pre className="text-[11px] text-muted-custom bg-elevated rounded p-3 whitespace-pre-wrap break-all font-mono">
            {diagnostics}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-text underline"
          >
            {copied ? (
              <Check className="w-3 h-3" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            {copied ? t("copied") : t("copyDiagnostics")}
          </button>
        </div>
      )}
    </div>
  );
}
