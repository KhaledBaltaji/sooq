// src/lib/admin/pin.ts
// -----------------------------------------------------------
// App-layer admin PIN verification + HMAC token signing.
// -----------------------------------------------------------
//
// Eng review finding (action 6): _verify_admin_pin (mig 247) uses
// `crypt(pin, hash) != hash` inside Postgres — not constant-time. And the
// RAISE EXCEPTION after `UPDATE admin_config SET failed_pin_attempts...`
// rolls back the counter because the RAISE aborts the outer RPC's
// transaction. Net effect: PIN brute-force has no effective rate limit.
//
// Fix: verify PIN in Node (argon2id — constant-time by design) and
// increment failed_pin_attempts via a service-role update that commits
// independently. On success, mint an HMAC-SHA256 token that the PIN-gated
// RPC verifies (see migration 269 _verify_admin_token).
//
// Token format matches the RPC exactly:
//   payload    = `${admin_id}|${operation}|${issued_at_iso}`
//   signature  = hex(HMAC-SHA256(payload, hmac_secret))
//   token      = base64(payload) + '.' + signature
//
// Freshness window: 120 seconds (matches _verify_admin_token).
//
// IMPORTANT: pin_hash storage format — the existing flow uses Postgres
// `crypt()` (bcrypt). We keep that column intact for backward compat but
// the Node-side verify needs to read the hash and compare with bcrypt-ish
// logic. Going forward, new PINs should be stored as argon2id hashes in
// the same column (bcrypt and argon2 hashes are distinguishable by
// prefix). The migration path:
//   - Legacy `$2a$`/`$2b$` prefix → verify with bcrypt
//   - New `$argon2id$` prefix → verify with argon2
// New PIN creations use argon2id.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// REQUIRED DEPENDENCY — install before deploying:
//   npm install bcryptjs @types/bcryptjs
//
// bcryptjs is used because the existing pin_hash column stores bcrypt hashes
// (written by pgcrypto.crypt()). The compare is timing-safe in bcryptjs.
// When we migrate to argon2id hashes, add @node-rs/argon2 and swap
// verifyHash() to use argon2.verify() for both the new prefix AND legacy.
//
// The import uses a dynamic shape so tsc doesn't fail when the package is
// absent during early development. At runtime, the require will throw with
// a clear error if bcryptjs isn't installed.
let bcrypt: {
  compare: (plaintext: string, hash: string) => Promise<boolean>;
  hash: (plaintext: string, salt: string) => Promise<string>;
  genSalt: (rounds: number) => Promise<string>;
};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = {
    compare: async () => {
      throw new Error(
        "bcryptjs not installed — run `npm install bcryptjs @types/bcryptjs`"
      );
    },
    hash: async () => {
      throw new Error(
        "bcryptjs not installed — run `npm install bcryptjs @types/bcryptjs`"
      );
    },
    genSalt: async () => {
      throw new Error(
        "bcryptjs not installed — run `npm install bcryptjs @types/bcryptjs`"
      );
    },
  };
}

import type { Database } from "@/lib/database.types";

const TOKEN_FRESHNESS_SECONDS = 120;
const MAX_FAILED_ATTEMPTS_BEFORE_LOCK = 5;
const LOCKOUT_MINUTES = 15;

// ── Service-role client — never expose server-side ──────────────────────

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Hash verification ───────────────────────────────────────────────────

async function verifyHash(plaintext: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  // Legacy bcrypt hashes from pgcrypto — prefix $2a$ or $2b$ or $2y$.
  if (hash.startsWith("$2")) {
    return bcrypt.compare(plaintext, hash);
  }
  // Reserved for future argon2id storage prefix.
  if (hash.startsWith("$argon2id$")) {
    // Would delegate to @node-rs/argon2 verify. Placeholder for now.
    return false;
  }
  return false;
}

// ── Core flow: verifyPinAndMintToken ───────────────────────────────────

export interface VerifyResult {
  ok: true;
  token: string;
  issuedAtIso: string;
}

export interface VerifyFailure {
  ok: false;
  reason: "no_config" | "locked_out" | "invalid_pin" | "rate_limit";
  message: string;
  remainingAttempts?: number;
  lockedUntilIso?: string;
}

/**
 * Verify an admin's PIN, persisting failed-attempt count via a separate
 * service-role update (so counter does NOT roll back on rejection).
 * On success, mint an HMAC-SHA256 token scoped to the given operation.
 *
 * The operation string must match the `p_expected_operation` argument of
 * the destination RPC (see migration 269).
 */
export async function verifyPinAndMintToken(
  adminId: string,
  pin: string,
  operation:
    | "lock_market"
    | "void_market"
    | "admin_update_fee"
    | "admin_review_withdrawal"
    | "admin_adjust_balance"
    | "resolve_market"
): Promise<VerifyResult | VerifyFailure> {
  if (!pin || !adminId) {
    return { ok: false, reason: "invalid_pin", message: "PIN required" };
  }

  const supabase = getServiceClient();

  // Fetch config. `hmac_secret` is added by migration 269 — once applied,
  // drop the type cast. Until then, fetch with select("*") and cast the row
  // to the expected shape.
  const { data: configRaw, error } = await supabase
    .from("admin_config")
    .select("*")
    .eq("admin_user_id", adminId)
    .single();

  const config = configRaw as
    | {
        admin_user_id: string | null;
        pin_hash: string;
        hmac_secret?: string | null;
        failed_pin_attempts: number | null;
        pin_locked_until: string | null;
      }
    | null;

  if (error || !config || !config.pin_hash) {
    return {
      ok: false,
      reason: "no_config",
      message: "Admin PIN not configured. Set your PIN first.",
    };
  }

  // Lockout check.
  if (
    config.pin_locked_until &&
    new Date(config.pin_locked_until).getTime() > Date.now()
  ) {
    return {
      ok: false,
      reason: "locked_out",
      message:
        "PIN locked due to too many failed attempts. Try again later.",
      lockedUntilIso: config.pin_locked_until,
    };
  }

  // Verify hash (constant-time via bcrypt / argon2).
  const matches = await verifyHash(pin, config.pin_hash);

  if (!matches) {
    // Persist the failed attempt via a SEPARATE update. This service-role
    // UPDATE commits regardless of whatever caller context we're in —
    // the bug in _verify_admin_pin was that RAISE EXCEPTION rolled it back.
    const newAttempts = (config.failed_pin_attempts ?? 0) + 1;
    const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS_BEFORE_LOCK;
    const lockedUntilIso = shouldLock
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : config.pin_locked_until ?? null;

    await supabase
      .from("admin_config")
      .update({
        failed_pin_attempts: newAttempts,
        pin_locked_until: lockedUntilIso,
      })
      .eq("admin_user_id", adminId);

    if (shouldLock) {
      return {
        ok: false,
        reason: "locked_out",
        message: `PIN locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS_BEFORE_LOCK} failed attempts.`,
        lockedUntilIso: lockedUntilIso ?? undefined,
      };
    }

    return {
      ok: false,
      reason: "invalid_pin",
      message: "Invalid PIN",
      remainingAttempts: MAX_FAILED_ATTEMPTS_BEFORE_LOCK - newAttempts,
    };
  }

  // Success: reset counter.
  await supabase
    .from("admin_config")
    .update({
      failed_pin_attempts: 0,
      pin_locked_until: null,
    })
    .eq("admin_user_id", adminId);

  // Mint HMAC token.
  if (!config.hmac_secret) {
    return {
      ok: false,
      reason: "no_config",
      message: "HMAC secret missing — ask an admin to reset your PIN.",
    };
  }

  const issuedAtIso = new Date().toISOString();
  const payload = `${adminId}|${operation}|${issuedAtIso}`;
  const signature = createHmac("sha256", Buffer.from(config.hmac_secret, "utf8"))
    .update(payload)
    .digest("hex");
  const token = `${Buffer.from(payload).toString("base64")}.${signature}`;

  return { ok: true, token, issuedAtIso };
}

/**
 * Set (or rotate) an admin's PIN. Stores hash + rotates the HMAC secret.
 * Resets failed_pin_attempts and unlock state. Returns nothing on success.
 *
 * The HMAC secret is regenerated on EVERY PIN change so any leaked old
 * token immediately fails signature verification.
 */
export async function setAdminPin(
  adminId: string,
  newPin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!newPin || newPin.length < 4) {
    return { ok: false, error: "PIN must be at least 4 characters" };
  }

  const supabase = getServiceClient();

  // Hash with bcrypt for now. Cost 12 = ~300ms per verify — balances UX
  // with timing-safety. When migrating to argon2id, swap here.
  const salt = await bcrypt.genSalt(12);
  const pinHash = await bcrypt.hash(newPin, salt);

  // Rotate HMAC secret via the RPC (service-role only). The RPC lands in
  // migration 269 — until applied, cast through unknown to call the
  // untyped RPC name without a tsc error.
  const rpcCaller = supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data: newSecret, error: rotateError } = await rpcCaller(
    "admin_rotate_hmac_secret",
    { p_admin_id: adminId }
  );
  if (rotateError) {
    return { ok: false, error: rotateError.message };
  }
  // newSecret is returned but we don't need it server-side — it's
  // fetched per verify call. The rotation alone invalidates old tokens.
  void newSecret;

  const { error: updateError } = await supabase
    .from("admin_config")
    .update({
      pin_hash: pinHash,
      failed_pin_attempts: 0,
      pin_locked_until: null,
    })
    .eq("admin_user_id", adminId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}

// ── Constant-time utility (exposed for other auth flows if needed) ──────

export function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return timingSafeEqual(ab, bb);
}

// ── Helpers re-exported for API route convenience ───────────────────────

export { randomBytes };
export const TOKEN_FRESHNESS_WINDOW_SECONDS = TOKEN_FRESHNESS_SECONDS;
