#!/usr/bin/env node
/**
 * CI guardrail: verify every NEXT_PUBLIC_* and server-only env var referenced
 * in src/ is defined on BOTH Vercel Preview and Vercel Production.
 *
 * Catches the "commission-branch 404" class of bug where a new feature flag
 * ships to staging but is missed when wiring production.
 *
 * Env required:
 *   VERCEL_TOKEN       — read-only token (team scope); set as GitHub secret
 *   VERCEL_PROJECT_ID  — prj_... ; from .vercel/project.json
 *   VERCEL_ORG_ID      — team_... ; from .vercel/project.json
 *
 * Exit codes: 0 = parity, 1 = drift detected, 2 = config/API error.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// ---------- Config ----------

/**
 * Env vars we deliberately DO NOT require parity for.
 * - Dev/test-only: never set on Vercel.
 * - Platform-provided: Vercel injects these (VERCEL_URL, VERCEL_ENV).
 * - NODE_ENV / NEXT_RUNTIME: runtime-set, not user-config.
 */
const IGNORE = new Set<string>([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "VERCEL_URL",
  "VERCEL_ENV",
  "SUPABASE_TEST_URL", // test-runner only
]);

// Targets to check parity across
const TARGETS = ["production", "preview"] as const;
type Target = (typeof TARGETS)[number];

// ---------- Code scan ----------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

function collectReferencedEnvVars(rootDir: string): Set<string> {
  const found = new Set<string>();
  const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  for (const file of walk(rootDir)) {
    // Skip test files — they may reference vars only meaningful locally.
    if (file.includes("/tests/") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(re)) {
      const name = match[1];
      if (!IGNORE.has(name)) found.add(name);
    }
  }
  return found;
}

// ---------- Vercel API ----------

type VercelEnv = {
  key: string;
  target: string[]; // ["production"], ["preview"], etc.
  gitBranch?: string | null;
};

async function fetchVercelEnvs(
  projectId: string,
  teamId: string,
  token: string,
): Promise<VercelEnv[]> {
  const url = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("decrypt", "false");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { envs: VercelEnv[] };
  return data.envs;
}

function indexByTarget(envs: VercelEnv[]): Record<Target, Set<string>> {
  const out: Record<Target, Set<string>> = {
    production: new Set(),
    preview: new Set(),
  };
  for (const e of envs) {
    for (const t of e.target) {
      if (t === "production" || t === "preview") out[t].add(e.key);
    }
  }
  return out;
}

// ---------- Diff ----------

function diff(
  required: Set<string>,
  present: Record<Target, Set<string>>,
): { target: Target; missing: string[] }[] {
  const report: { target: Target; missing: string[] }[] = [];
  for (const target of TARGETS) {
    const missing: string[] = [];
    for (const key of required) {
      if (!present[target].has(key)) missing.push(key);
    }
    if (missing.length) report.push({ target, missing: missing.sort() });
  }
  return report;
}

// ---------- Main ----------

async function main() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_ORG_ID;

  if (!token || !projectId || !teamId) {
    console.error(
      "Missing required env: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID",
    );
    process.exit(2);
  }

  const required = collectReferencedEnvVars("src");
  console.log(`Found ${required.size} env vars referenced in src/:`);
  for (const k of [...required].sort()) console.log(`  - ${k}`);

  let envs: VercelEnv[];
  try {
    envs = await fetchVercelEnvs(projectId, teamId, token);
  } catch (err) {
    console.error(`Failed to fetch Vercel env vars: ${(err as Error).message}`);
    process.exit(2);
  }

  const present = indexByTarget(envs);
  console.log(
    `\nVercel has ${present.production.size} vars on Production, ${present.preview.size} on Preview.`,
  );

  const drift = diff(required, present);
  if (drift.length === 0) {
    console.log("\n✅ Env-var parity OK — all referenced vars present on Production and Preview.");
    process.exit(0);
  }

  console.error("\n❌ Env-var drift detected:");
  for (const { target, missing } of drift) {
    console.error(`\n  Missing on ${target}:`);
    for (const key of missing) console.error(`    - ${key}`);
  }
  console.error(
    "\nAdd these in Vercel → Project → Settings → Environment Variables,",
  );
  console.error(
    "then redeploy. NEXT_PUBLIC_* vars are baked in at build time —",
  );
  console.error("uncheck 'Use existing Build Cache' when redeploying.");
  process.exit(1);
}

main();
