# Sooq Sprint Log

A running record of the 10–12 week rebuild from `prediction-market` (LMSR + branches + commission, on Supabase) to `sooq` (speed-only on AWS). Plan: `~/.claude/plans/oh-my-how-much-giggly-crystal.md`.

Each entry: what was done, decisions, deviations from plan, surprises, time spent.

---

## W1 — Setup

**Goal:** Copy the codebase wholesale, get it building locally, wire bare-minimum CI, ready for stripping in W2.

### Done

- Copied codebase from `~/Desktop/prediction-market` (commit `a83180f`) to `~/Desktop/Sooq` via `git archive` (868 tracked files, 11 MB)
- Fresh `.claude/sessions/{locks,migrations,completed}/` skeleton (old session state did not carry over since `.claude/sessions/` is gitignored)
- `git init -b main` in the new repo (no remote yet — pending repo name decision)
- Updated `package.json` identity: `name: sooq`, `version: 0.1.0`, `description: "Sooq Speed — BTC fast-cycle trading"`
- Added dependencies: `drizzle-orm ^0.36.0`, `drizzle-kit ^0.27.0`, `pg ^8.13.0`, `@types/pg ^8.11.0`. Auth.js (`next-auth`) deferred to W6.
- Deleted stale `package-lock.json` from copy, ran fresh `npm install` (705 packages, 1 min)
- Replaced `.github/workflows/ci.yml` with bare-minimum lint + type-check on PRs and pushes
- Disabled (renamed to `.disabled`) all Supabase-coupled workflows: `deploy-staging`, `deploy-production`, `deploy-oracle-staging`, `env-parity`, `migration-check`, `nightly-full-test`, `staging-crons{,-weekly}`. They get fully removed during W2/W3 strip.
- Slimmed the git hooks: `pre-commit` no longer runs the schema-snapshot drift check (Supabase-specific); `pre-push` now only blocks direct pushes to `main` (smoke suite removed since most of those tests get deleted in W2/W3)
- Type-check passes (`npx tsc --noEmit` exit 0) after two minor fixes — see deviations

### Decisions

- **Local Postgres in W2 will run via Docker.** Docker Desktop installed but daemon not running; user starts it before W2 work.
- **Auth.js install deferred to W6.** Avoids pulling beta packages into W1 type-check before they're needed.
- **Disabled-not-deleted CI workflows.** Rename keeps them as reference until the W2/W3 strip phase removes them properly.
- **`.npmrc`, `.env.local.example`, `next.config.ts`, `sentry.*.config.ts` carried over unchanged.** Sentry config keeps the same 10% sampling rate; will be re-evaluated in W10.

### Deviations from plan

- **Type-check needed two small fixes** before passing. Fresh `npm install` (no lockfile) resolved newer versions of `@supabase/ssr` / `@supabase/supabase-js` types that are stricter about `.update()` call shapes. Two files affected:
  - `src/app/(app)/settings/page.tsx:171` — replaced `Record<string, string | null>` with a typed shape `{ display_name: string; bio: string | null; email?: string }`
  - `src/app/auth/callback/route.ts:108` — same swap to `{ email?: string; display_name?: string; avatar_url?: string }`
  - Both files will be rewritten in W6 (Auth.js port) anyway; this is a transitional fix.

### Surprises

- **WhatsApp OTP is fully wired in production already** via VerifyWay API (`src/lib/verifyway.ts`, routes at `/api/auth/{send-otp,verify-otp}`, migration 201). W6 ports the existing implementation rather than building from scratch.
- **`speed_branches` coupling is heavier than expected.** `execute_speed_trade` (mig 319) is a state machine keyed on reseller-vs-retail flow. Estimated W3 effort 2.5–4 days, tight against the 5-day W3 budget. Functions needing rewrite: `execute_speed_trade`, `speed_execute_cashout`, `speed_resolve_market`. Investigation report: see agent output in chat history (todo: persist to `docs/STRIP_NOTES.md` early in W2).

### Time spent

- ~30 min wall clock for the copy + setup (plus ~1 min `npm install` in background)

### Open from W1

These need user input or external action before W2/W3 work can be promoted:

1. **Install + start Docker Desktop daemon** (needed before W2 local Postgres work)
2. **`brew install pgcli`** (and `psql` via `brew install postgresql` — only the client, not the server)
3. **Choose new GitHub repo name** (suggestions: `sooq-speed`, `sooq-speed-v1`, `sooq-v2` — current local package is `sooq`)
4. **Confirm AWS region target** (Bahrain `me-south-1` vs Frankfurt `eu-central-1`) — can defer until W5 but a directional answer informs the W5 service-coverage audit
5. **Confirm fee values** before W3 (trading fee %, AMM spread params, cash-out premium %, resolution fee %) — currently read from `fee_config` table; getting hardcoded in W3
6. **`speed_branches` coupling** documented in scratch only; need to write up `docs/STRIP_NOTES.md` early in W2 to capture the W3 plan

### Phase boundary checkpoint (W1 → W2)

- [x] `npx tsc --noEmit` passes (exit 0)
- [x] `npm install` completes (705 packages)
- [ ] `npm run lint` — not run yet, will run before W2 commit
- [x] CI green: bare-minimum workflow in place (will only run when remote is wired)
- [x] Lockfile + `.claude/sessions/locks` skeleton in place
- [ ] User explicitly approves "ready for W2"

---
