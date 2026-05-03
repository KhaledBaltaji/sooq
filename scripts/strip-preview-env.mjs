// Strip the `preview (staging)` copies of every env var on the Sooq project.
//
// Earlier in W7 we pushed each var to production + preview(staging) +
// development. Vercel uses those preview-scoped copies as a uniqueness
// claim on the branch, blocking us from setting `staging` as the
// Production Branch. Production + Development copies are untouched, so
// the new production deploys still see them.
//
// Idempotent: any vars already missing from preview just log "skipped".
//
// Usage: cd /Users/khaledbaltaji/Desktop/Sooq && node scripts/strip-preview-env.mjs

import { spawn } from "node:child_process";

const KEYS = [
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "THREEPAY_API_KEY",
  "THREEPAY_API_SECRET",
  "THREEPAY_BASE_URL",
  "THREEPAY_WEBHOOK_SECRET",
  "VERIFYWAY_API_KEY",
  "NEXT_PUBLIC_SUPPORT_WHATSAPP",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "DATABASE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_S3_DEPOSITS_BUCKET",
  "AWS_S3_THUMBNAILS_BUCKET",
];

function rmOne(key, target, branch) {
  return new Promise((resolve) => {
    const args = ["env", "rm", key, target];
    if (branch) args.push(branch);
    args.push("--yes");

    const proc = spawn("vercel", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      const merged = stdout + stderr;
      if (code === 0) {
        resolve({ ok: true });
      } else if (/no environment variable was found|not found/i.test(merged)) {
        resolve({ ok: true, note: "already absent" });
      } else {
        resolve({ ok: false, err: merged.trim().slice(0, 200) });
      }
    });
  });
}

let failures = 0;
for (const key of KEYS) {
  const result = await rmOne(key, "preview", "staging");
  const note = result.note ? ` (${result.note})` : "";
  if (result.ok) {
    console.log(`✓ ${key}${note}`);
  } else {
    failures += 1;
    console.error(`✗ ${key}: ${result.err}`);
  }
}
console.log(`\nDone. ${failures} failures.`);
process.exit(failures > 0 ? 1 : 0);
