import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";

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

// ---- system_logs persistence (fire-and-forget) ----

let _logClient: ReturnType<typeof createClient> | null = null;

function getLogClient() {
  if (
    !_logClient &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    _logClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _logClient;
}

/** Persist error/critical logs to system_logs table for admin dashboard visibility. */
export function persistToSystemLogs(
  severity: "error" | "critical",
  message: string,
  context: Record<string, unknown>
) {
  try {
    const client = getLogClient();
    if (!client) return;
    // Fire-and-forget — don't await, don't block the caller
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (client.from("system_logs") as any).insert({
      severity,
      source: (context.source as string) || "app",
      message: message.slice(0, 1000),
      context,
    });
  } catch {
    // Never crash on logging failure
  }
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
    // Always persist to system_logs for admin dashboard visibility
    persistToSystemLogs("error", message, context);
  },

  critical(
    message: string,
    context: Record<string, unknown> = {},
    error?: unknown
  ) {
    const payload = buildPayload("critical", message, context);
    // Always log critical errors
    console.error(JSON.stringify(payload));
    // Always send critical to Sentry regardless of environment
    sendToSentry("critical", message, context, error);
    // Always persist to system_logs for admin dashboard visibility
    persistToSystemLogs("critical", message, context);
  },
};
