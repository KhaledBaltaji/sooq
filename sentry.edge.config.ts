import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV || "development",
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1.0,

  // T5.7: redact PII (phone, email, balance, amounts, IP) before shipping.
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
