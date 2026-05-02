import * as Sentry from "@sentry/nextjs";
import { persistToSystemLogs } from "@/lib/logger";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || "development",

  // Reduce sampling in production to control costs
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1.0,

  // Filter out noisy errors
  ignoreErrors: [
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
    "transformAlgorithm", // Node.js SSR TransformStream internal
  ],

  // Persist unhandled errors to system_logs for admin dashboard visibility
  beforeSend(event) {
    if (event.level === "error" || event.level === "fatal") {
      const message =
        event.exception?.values?.[0]?.value ||
        event.message ||
        "Unhandled server error";
      persistToSystemLogs(
        event.level === "fatal" ? "critical" : "error",
        message,
        {
          source: "sentry/server",
          eventId: event.event_id,
          url: event.request?.url,
        }
      );
    }
    return event;
  },
});
