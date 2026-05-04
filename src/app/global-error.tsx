"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

// global-error.tsx is loaded outside the locale + design-system context, so
// it uses inline styles and plain English (no Tailwind, no next-intl).
// Triggers when a render-phase exception escapes every other boundary —
// e.g. a throw in (app)/layout.tsx that wasn't caught by a sub-boundary.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
    <html>
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              backgroundColor: "rgba(239,68,68,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
            }}
          >
            !
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#666", fontSize: "14px", maxWidth: "400px" }}>
            {error.message || "An unexpected error occurred. Please try again."}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "8px 24px",
              backgroundColor: "#22c55e",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "12px",
              textDecoration: "underline",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && (
            <div style={{ width: "100%", maxWidth: "440px", textAlign: "left" }}>
              <pre
                style={{
                  fontSize: "11px",
                  color: "#444",
                  backgroundColor: "#f4f4f5",
                  borderRadius: "6px",
                  padding: "12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                  margin: 0,
                }}
              >
                {diagnostics}
              </pre>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  marginTop: "8px",
                  background: "none",
                  border: "none",
                  color: "#111",
                  fontSize: "12px",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {copied ? "Copied" : "Copy diagnostics"}
              </button>
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
