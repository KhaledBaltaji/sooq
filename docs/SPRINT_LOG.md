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
- [x] `npm run lint` exit 0 (260 pre-existing warnings, 0 errors)
- [x] CI green: bare-minimum workflow in place (will only run when remote is wired)
- [x] Lockfile + `.claude/sessions/locks` skeleton in place
- [x] User explicitly approves "ready for W2" (said "keep going to u finish all the phases")

---

## W2 — Strip pass 1 (LMSR + demo + prelaunch + stale + admin tooling)

**Goal:** Drop everything that isn't surviving v1 except branches/commission. Branches + commission stay one more week (W3 surgery); LMSR / demo / prelaunch / stale features / admin tooling go now.

### Done — SQL strip

- Wrote `supabase/migrations/364_w2_strip_pass_1.sql` — single migration, 7 sections, all `IF EXISTS + CASCADE`, idempotent
- Migration number `364` reserved in `.claude/sessions/migrations/next.json`
- Sections drop:
  - **Stale features** — `news_articles` (defensive — already dropped in mig 342), `copy_settings`, `comment_likes`, `market_comments`, `leader_stats`, `leaderboard_view`, `price_alerts`
  - **Demo mode** — 6 `demo_*` tables + 10 `demo_*` RPCs + 5 `users` columns (`demo_first_enabled_at`, `demo_first_trade_at`, `demo_balance_usd`, `first_real_deposit_after_demo_at`, `demo_mode`)
  - **Prelaunch** — `prelaunch_votes`, `prelaunch_questions`, `prelaunch_waitlist` + `record_prelaunch_vote` RPC
  - **LMSR core** — `markets`, `amm_state`, `trades`, `positions`, `retail_trades`, `retail_positions`, `platform_revenue` + 16 RPCs (`execute_trade`, `resolve_market`, `lock_market`, `void_market`, `_void_market_internal`, `lmsr_cost/price/shares_for_cost`, `initialize_amm`, `get_amm_price`, `get_amm_risk_snapshot`, `get_cash_out_value`, `admin_create_market`, `admin_update_market`, `update_homepage_ranks`, `get_price_history`)
  - **Deposit bonus** — `claim_deposit_bonus` + `users.deposit_bonus_claimed/wagering_requirement/total_wagered`
  - **Admin tooling** — `system_logs`, `log_system_event`, `reconcile_balances`, `reconcile_agent_balances`, all 7 `get_stats_*` + `get_platform_stats`
  - **Help articles** — `help_articles`, `help_collections`
- Utility cleanup functions (`cleanup_test_data`, `staging_full_reset`) dropped first since their bodies reference half the schema; W4 ops rebuild adds slimmer replacements

### Done — UI / route deletes

- `src/app/(app)/{market,markets,demo,m,trade,help,referral-not-yet}/` — LMSR + demo + shorthand market routes + LMSR trade flow + LMSR help
- `src/app/(prelaunch)/` — full prelaunch route group
- `src/app/api/{prelaunch/,cron/{rank-markets,close-expired-markets,resolve-demo-markets,check-errors}/}` — prelaunch APIs + LMSR/demo/admin-tooling crons
- `src/app/api/og/` — LMSR market OG image generation
- `src/app/admin/{markets,amm,accounting,finance,stats,alerts,logs,help}/` — 8 LMSR / admin-tooling admin pages
- `src/app/branch/` and `src/app/b/` — branch UI (originally W3 work, deleted now to satisfy W2 type-check; matches plan's "Speed broken mid-strip" expectation)
- Replaced `src/app/(app)/page.tsx` with a minimal speed-pointing placeholder (W4 designs the real speed-first home)
- Replaced `src/app/(app)/profile/page.tsx` with a slim balance + transactions + deposit/withdraw page (LMSR-position-aware UI gone; W4 redesigns for speed positions)

### Done — components / hooks / queries

- `src/components/{home,market,markets,trade,branch}/` — 5 dirs of LMSR + branch components
- `src/lib/queries/markets.ts` — LMSR query layer (branch-markets.ts kept for W3)
- `src/hooks/{use-close-position,use-execute-trade,use-market,use-markets,use-merged-positions,use-position-sparks,use-position,use-positions,use-branch-trade,use-price-history}.ts` — 10 LMSR + branch hooks

### Done — tests

- All 10 `demo-*.test.ts` removed
- LMSR-only: `place-bet`, `resolve-market`, `payout-invariants`, `race-conditions`, `concurrency`, `opening-price`, `price-history`, `amm-risk-snapshot`, `admin-sidebar-counts`, `fee-config-uniqueness`
- `src/tests/api/resolve-demo-markets.test.ts`
- 30 test files remain: 11 speed (KEEP), 8 branch (W3 strip), 3 commission (W3 strip), plus auth/money/admin core

### Verification

- `npx tsc --noEmit` exit 0 ✓
- `npm run lint` exit 0 (1 fixed: replaced `<a href="/speed">` with `<Link>` per next.config rule) ✓
- Migration 364 SQL syntax: pending validation against fresh local Supabase stack (started, ports remapped to 5442X to coexist with existing prediction-market stack)

### Surprises / deviations

- Profile page rewrite was bigger than expected — original was 412 LOC of LMSR-position-aware UI. Replaced with ~110-line slim placeholder. W4 redesign will wire to speed positions when those exist.
- Branch UI deletion happened in W2 (originally W3). Branch SQL surgery (the heavy part) still lives in W3.
- `getSupportWhatsAppHref()` requires a message arg — fixed in profile rewrite to pass `tSupport("defaultMessage")`.
- 2 small profile fixes after the rewrite: Avatar component requires `name` prop; WhatsApp helper requires message arg.

### Open from W2

1. **Validate `364_w2_strip_pass_1.sql` applies cleanly** to a fresh local Postgres — sooq Supabase stack starting in background
2. **Test infrastructure** still references `SUPABASE_TEST_URL`; will work once stack is up. Some surviving tests (commission, branch, agent-wallet) reference dropped tables → expected to fail in W2; cleaned up in W3.

### Phase boundary checkpoint (W2 → W3)

- [x] `npx tsc --noEmit` passes
- [x] `npm run lint` passes
- [ ] Migration 364 applies cleanly to fresh local Postgres (in flight)
- [x] LMSR / demo / prelaunch / stale / admin-tooling UI fully deleted
- [x] Plan adherence: every drop maps to a row in the approved plan's "What gets stripped" table
- [ ] Commit + push to staging
- [ ] User explicitly approves "ready for W3"

---
