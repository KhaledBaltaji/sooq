import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",

  // Reduce sampling in production to control costs
  tracesSampleRate: process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? 0.1 : 1.0,

  // Capture 100% of sessions that have an error
  replaysOnErrorSampleRate: 1.0,
  // Don't record sessions without errors
  replaysSessionSampleRate: 0,

  // Only init replays if DSN is set
  integrations: process.env.NEXT_PUBLIC_SENTRY_DSN
    ? [Sentry.replayIntegration()]
    : [],

  // Filter out noisy errors
  ignoreErrors: [
    "ResizeObserver loop",
    "Network request failed",
    "Load failed",
    "ChunkLoadError",
    "transformAlgorithm", // Next.js/Node SSR TransformStream internal
    "SooqLogo is not defined", // stale CDN chunk — remove after 2026-04-15
  ],

  // Persist unhandled client errors to system_logs via internal API
  beforeSend(event) {
    if (event.level === "error" || event.level === "fatal") {
      const message =
        event.exception?.values?.[0]?.value ||
        event.message ||
        "Unhandled client error";
      // Fire-and-forget POST to internal logging endpoint
      fetch("/api/internal/log-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          source: "sentry/client",
          context: {
            eventId: event.event_id,
            url: typeof window !== "undefined" ? window.location.href : undefined,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          },
        }),
      }).catch(() => {
        // Never block Sentry on logging failure
      });
    }
    return event;
  },
});
