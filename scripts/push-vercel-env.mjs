// Push every env var from .env.local into the linked Vercel project for
// all three environments (production, preview, development).
//
// Skips: empty lines, comments, deprecated keys (CRON_SECRET — HTTP cron
// routes were deleted in W7, no longer needed).
//
// Usage:  node scripts/push-vercel-env.mjs
//   (run from /Users/khaledbaltaji/Desktop/Sooq with .vercel/project.json
//    already linked.)

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const SKIP_KEYS = new Set([
  "CRON_SECRET", // HTTP cron routes deleted; pg_cron handles speed jobs
]);

const ENV_FILE = ".env.local";
// (target, branchArg) — preview needs an explicit branch in CLI v50+.
// "staging" is the only branch we deploy from for now; revisit when main lands.
const TARGETS = [
  ["production", null],
  ["preview", "staging"],
  ["development", null],
];

const lines = readFileSync(ENV_FILE, "utf8").split("\n");
const entries = [];
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx < 0) continue;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1);
  if (!key || SKIP_KEYS.has(key)) continue;
  entries.push({ key, value });
}

console.log(`Pushing ${entries.length} env vars × ${TARGETS.length} targets...`);

function pushOne(key, value, target, branch) {
  return new Promise((resolve, reject) => {
    const args = ["env", "add", key, target];
    if (branch) args.push(branch);
    const proc = spawn("vercel", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const merged = stdout + stderr;
        // Treat "already exists" as a soft success — env var is already set.
        if (/already exists|environment variable was added/i.test(merged)) {
          resolve({ ok: true, note: "already exists" });
        } else {
          reject(new Error(`exit ${code}: ${merged.trim().slice(0, 200)}`));
        }
      }
    });

    proc.stdin.write(value);
    proc.stdin.end();
  });
}

let failures = 0;
for (const { key, value } of entries) {
  for (const [target, branch] of TARGETS) {
    const label = branch ? `${target}[${branch}]` : target;
    try {
      const result = await pushOne(key, value, target, branch);
      const note = result.note ? ` (${result.note})` : "";
      console.log(`  ✓ ${key} → ${label}${note}`);
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${key} → ${label}: ${err.message}`);
    }
  }
}

console.log(`\nDone. ${failures} failures.`);
process.exit(failures > 0 ? 1 : 0);
