/**
 * Branch slug rules.
 *
 * Single source of truth for slug validation. Imported by:
 *   - Admin create form (live validation)
 *   - Auth/route resolvers (defensive re-check)
 *
 * The same regex literal is embedded in the DB CHECK constraint in
 * supabase/migrations/293_commission_branch_constraints.sql — if you change
 * the regex here, update the migration (and write a follow-up migration to
 * replace the CHECK on production).
 */

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 20;

export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "app",
  "auth",
  "b",
  "branch",
  "branches",
  "dashboard",
  "demo",
  "help",
  "home",
  "login",
  "logout",
  "market",
  "markets",
  "r",
  "referral",
  "referrals",
  "settings",
  "signup",
  "signin",
  "sooq",
  "support",
  "terms",
  "privacy",
] as const;

const RESERVED_SET = new Set(RESERVED_SLUGS);

export type SlugValidationError =
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "reserved";

export interface SlugValidationResult {
  ok: boolean;
  error?: SlugValidationError;
  message?: string;
}

export function validateSlug(slug: string): SlugValidationResult {
  if (slug.length < SLUG_MIN_LENGTH) {
    return {
      ok: false,
      error: "too_short",
      message: `Slug must be at least ${SLUG_MIN_LENGTH} characters.`,
    };
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return {
      ok: false,
      error: "too_long",
      message: `Slug must be at most ${SLUG_MAX_LENGTH} characters.`,
    };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      error: "invalid_format",
      message:
        "Use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number.",
    };
  }
  if (RESERVED_SET.has(slug)) {
    return {
      ok: false,
      error: "reserved",
      message: "This slug is reserved.",
    };
  }
  return { ok: true };
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(slug);
}
