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
  ],
});
