/**
 * Shared Sentry beforeSend / beforeBreadcrumb hooks that strip PII before
 * events are shipped off-machine.
 *
 * What we redact:
 *   - phone numbers (E.164 +XXXXXXXXX)
 *   - email addresses
 *   - balance amounts (best-effort: keys named `balance_usd`, `balance`,
 *     `balanceUsd` in extras)
 *   - transaction amounts (keys named `amount`, `stake`, `cashout_amount`)
 *   - IP addresses (keep first octet for geographic-ish context)
 *
 * What we KEEP:
 *   - user_id (uuid; useful for correlating across log lines)
 *   - market_id, position_id, trade_id (operational)
 *   - error message + stack trace
 *   - non-PII tags (source, route, status code)
 *
 * The 10% trace sample multiplied by these scrubs gives us ops visibility
 * with substantially reduced PII exposure.
 */

import type { ErrorEvent, EventHint, Breadcrumb, BreadcrumbHint } from "@sentry/nextjs";

const REDACTED = "[redacted]";

// PII-shaped keys whose values we always redact when found in extras / contexts.
const PII_KEYS = new Set<string>([
  "phone",
  "phone_number",
  "phoneNumber",
  "email",
  "balance",
  "balance_usd",
  "balanceUsd",
  "balance_after",
  "stake",
  "amount",
  "cashout_amount",
  "cashoutAmount",
  "potentialPayout",
  "to_win",
  "toWin",
  "ip",
  "ip_address",
  "address",
]);

// Regex matchers for inline PII in free-text strings.
const PHONE_RE = /\+\d{8,15}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function redactString(s: string): string {
  return s
    .replace(PHONE_RE, "[phone]")
    .replace(EMAIL_RE, "[email]")
    .replace(IP_RE, "[ip]");
}

function redactValue(key: string | undefined, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (key && PII_KEYS.has(key)) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(undefined, v));
  if (typeof value === "object") return scrubObject(value as Record<string, unknown>);
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  // Top-level message + exception text.
  if (event.message) event.message = redactString(event.message);
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redactString(ex.value);
    }
  }
  // Extra context values.
  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }
  // Tag values (tags are usually low-risk but we still scrub strings).
  if (event.tags) {
    const t: Record<string, string | number | boolean | bigint | symbol | null | undefined> = {};
    for (const [k, v] of Object.entries(event.tags)) {
      t[k] = typeof v === "string" ? redactString(v) : v;
    }
    event.tags = t;
  }
  // User identifier — keep id (uuid) but strip email/phone if attached.
  if (event.user) {
    const u = { ...event.user };
    delete u.email;
    delete (u as { phone?: string }).phone;
    if (typeof u.ip_address === "string") u.ip_address = "[ip]";
    event.user = u;
  }
  // Request URL / headers — redact phone in query strings, email/auth headers.
  if (event.request) {
    if (event.request.url) event.request.url = redactString(event.request.url);
    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        const lower = k.toLowerCase();
        if (lower === "authorization" || lower === "cookie" || lower === "x-csrf-token") {
          headers[k] = REDACTED;
        } else {
          headers[k] = typeof v === "string" ? redactString(v) : String(v);
        }
      }
      event.request.headers = headers;
    }
  }
  return event;
}

export function scrubBreadcrumb(
  bc: Breadcrumb,
  _hint?: BreadcrumbHint,
): Breadcrumb | null {
  if (bc.message) bc.message = redactString(bc.message);
  if (bc.data) {
    bc.data = scrubObject(bc.data);
  }
  return bc;
}
