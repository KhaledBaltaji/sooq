import * as Sentry from "@sentry/nextjs";

// W2 cleanup: system_logs table was dropped along with the rest of the
// admin tooling. Logger is now console + Sentry only. The lean ops rebuild
// between W10 and W11 will add a leaner persistence layer if needed.

type LogLevel = "info" | "warn" | "error" | "critical";

interface LogPayload {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function buildPayload(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>
): LogPayload {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
}

function sendToSentry(
  level: LogLevel,
  message: string,
  context: Record<string, unknown>,
  error?: unknown
) {
  const sentryLevel = level === "critical" ? "fatal" : level;

  Sentry.withScope((scope) => {
    scope.setLevel(sentryLevel as Sentry.SeverityLevel);
    scope.setTags({
      logLevel: level,
      source: (context.source as string) || "unknown",
    });
    scope.setExtras(context);

    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(message, sentryLevel as Sentry.SeverityLevel);
    }
  });
}

export const logger = {
  info(message: string, context: Record<string, unknown> = {}) {
    const payload = buildPayload("info", message, context);
    if (process.env.NODE_ENV === "production") {
      console.log(JSON.stringify(payload));
    } else {
      console.log(`[INFO] ${message}`, context);
    }
  },

  warn(message: string, context: Record<string, unknown> = {}) {
    const payload = buildPayload("warn", message, context);
    if (process.env.NODE_ENV === "production") {
      console.warn(JSON.stringify(payload));
    } else {
      console.warn(`[WARN] ${message}`, context);
    }
  },

  error(
    message: string,
    context: Record<string, unknown> = {},
    error?: unknown
  ) {
    const payload = buildPayload("error", message, context);
    if (process.env.NODE_ENV === "production") {
      console.error(JSON.stringify(payload));
      sendToSentry("error", message, context, error);
    } else {
      console.error(`[ERROR] ${message}`, context, error || "");
    }
  },

  critical(
    message: string,
    context: Record<string, unknown> = {},
    error?: unknown
  ) {
    const payload = buildPayload("critical", message, context);
    console.error(JSON.stringify(payload));
    sendToSentry("critical", message, context, error);
  },
};
