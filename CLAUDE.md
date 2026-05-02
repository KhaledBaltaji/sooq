# CLAUDE.md — MENA Prediction Market

## Project Overview
Real-money political prediction exchange for the MENA region, launching in Lebanon. **LMSR AMM (Automated Market Maker)** — users buy/sell shares at real-time prices, cash out anytime. Fintech UX hiding crypto settlement.

**Model:** V3 AMM (replaces V2 pool-based model). Full migration — no V2 coexistence.

## Tech Stack
- **Frontend:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions)
- **Hosting:** Vercel (frontend) + Supabase (backend)
- **Payment:** 3pay (USDT/USDC) + Whish (Lebanese mobile payments)

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

For icons, use `lucide-react` only. See `docs/ICONS.md` for stroke width, size scale, and brand-icon conventions.

## Architecture
- Supabase-only (no separate Node.js backend)
- All financial logic in Postgres functions via `supabase.rpc()`
- **Core Postgres functions:** `execute_trade`, `resolve_market`, `_void_market_internal`, `void_market`, `lock_market`, `process_deposit`, `process_withdrawal`, `claim_deposit_bonus`, `update_agent_level`, `initialize_amm`, `get_amm_price`, `get_cash_out_value`, `lmsr_cost`, `lmsr_price`, `lmsr_shares_for_cost`, `pay_trade_commissions`, `settle_resolution_commissions`, `record_revenue`, `admin_adjust_balance`, `admin_update_fee`, `admin_create_market`, `admin_update_market`, `get_platform_stats`, `toggle_agent_activation_override`, `get_stats_users`, `get_stats_trading`, `get_stats_markets`, `get_stats_finance`, `get_stats_revenue`, `get_stats_health`, `get_price_history`, `update_homepage_ranks`, `search_news_for_market`, `record_prelaunch_vote`, `toggle_demo_mode`, `demo_reset_balance`, `demo_execute_trade`, `initialize_demo_amm`, `admin_create_demo_market`, `admin_resolve_demo_market`, `demo_get_price_history`, `get_demo_conversion_stats`, `admin_list_demo_markets_with_outcomes`, `demo_seed_initial_price`
- Append-only ledger pattern for all balance mutations
- `balance_usd` on users table is a cache — source of truth is `SUM(transactions)`

## AMM Model (LMSR)
- Each market has an AMM: `C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))`
- `b` = liquidity parameter (default 1000), controls price sensitivity
- YES shares pay $1.00 if YES wins, $0.00 if NO wins (and vice versa)
- Winning shares pay $0.99 (1% resolution fee)
- Users can buy AND sell anytime while market is open (full trading until resolution)

## Fee Architecture (Subliminal Model)
- **Visible:** 0.5% explicit trading fee (on every buy and sell)
- **Hidden:** AMM spread (~2-3%), resolution fee (1%), cash-out premium (0.5%), dynamic spread widening (0.5% avg)
- **Effective take rate:** ~5% per round trip
- All fee rates read from `fee_config` table, NEVER hardcoded

## Critical Security Rules
- **auth.uid():** All user-facing RPCs derive user from Supabase Auth session, NEVER from client-supplied user_id parameter. Only admin/webhook functions accept user_id.
- **SELECT FOR UPDATE:** All balance-mutating functions lock the user row + market row + amm_state row before reading.
- **Fee config:** All rates read from `fee_config` table, NEVER hardcoded.
- **Wagering:** Only buys count toward `total_wagered` (prevents churn exploit on sells).

## Commission Model
Multi-level revenue share on **total platform revenue** (explicit fee + AMM spread + cash-out premium).
4 agent levels by network volume: L1 (default), L2 ($10K+), L3 ($50K+), L4 ($200K+) × 2 layers (direct 30-50%, indirect 5-12%).
Activation gate: agents need 5 qualified referrals before commissions are credited (escrowed until then).
**Canonical spec:** `docs/commission-model.md` — read this before touching any commission code.

## Both-Side Trading
Users CAN hold both YES and NO positions on the same market. Every trade generates commission (fee-based, not exposure-based).
- Admin alert for both-side detection
- Leaderboard accuracy based on final net position P&L at resolution
- No same_side database constraint

## Deposit Bonus
$5 free on first deposit of $20+. ONLY for non-referred (organic) users.
Referred users do NOT get the bonus. 2x wagering requirement before withdrawal.

## Demo Mode
Isolated `/demo/*` sandbox with fully separate `demo_*` tables (migrations 270-272). $10K persistent demo balance per authenticated user. Pure LMSR trading with zero fees, zero commissions, zero revenue impact. Admin-scheduled outcomes + hourly cron auto-resolution. Conversion analytics (`demo_first_enabled_at`, `demo_first_trade_at`, `first_real_deposit_after_demo_at` on users).
**Iron invariants:** demo never writes to `transactions`, `positions`, `trades`, `commissions`, `platform_revenue`, `leader_stats`, or branch tables. Referral tree never touched. Route gate is `demo_first_enabled_at IS NOT NULL`, not `demo_mode`. Full spec: `docs/designs/demo-mode.md` and `docs/ARCHITECTURE.md` §18.

## Claude Code Operational Rules (MANDATORY)

### FORBIDDEN Actions — Never Do These
1. **NEVER** link Supabase CLI to production (`dwpizrhtyrquhibqcuuu`). Only `zzebptrztuwnqlxxmjuo` (staging) is allowed locally.
2. **NEVER** run `supabase db push` or `supabase db reset` unless user explicitly confirms AND linked project is verified as staging.
3. **NEVER** run destructive SQL (`TRUNCATE`, `DROP TABLE`, `DROP FUNCTION`, `DELETE FROM` without WHERE, `ALTER TABLE ... DROP COLUMN`) against any remote database without explicit user approval.
4. **NEVER** force push (`git push --force` or `git push -f`) to `main` or `staging` branches.
5. **NEVER** push directly to `main`. Production changes flow only through PRs: `staging` → `main`.
6. **NEVER** run `supabase db reset` on any remote project — this destroys all data.
7. **NEVER** display or log production database credentials.

### REQUIRED Actions — Always Do These
1. **ALWAYS** run `npm test` and confirm all tests pass before committing to staging.
2. **ALWAYS** verify the currently linked Supabase project before any `supabase` CLI command: `cat supabase/.temp/project-ref` must show `zzebptrztuwnqlxxmjuo`.
3. **ALWAYS** ask user for explicit confirmation before: pushing to any remote branch, creating/merging PRs, running migrations, running any SQL against a remote database.
4. **ALWAYS** update tests when migrations change schema (see Test-Migration Sync Rules below).

### Multi-Session Safety Protocol (MANDATORY)

This repo is frequently edited by multiple Claude Code sessions simultaneously on the same branch. Every session MUST follow this protocol to prevent conflicts.

#### Session Registration
1. On session start, create `.claude/sessions/locks/<YYYYMMDD-HHMMSS-XXXX>.json` with:
   - `session_id`, `started_at`, `description`, `areas` (file/dir paths planned to edit)
   - `migrations_reserved` (list of migration numbers), `last_heartbeat` (ISO timestamp)
2. Create `.claude/sessions/locks/` directory if it doesn't exist.

#### Before Editing ANY File — Conflict Check
1. Read ALL `.json` files in `.claude/sessions/locks/`.
2. Ignore lockfiles where `last_heartbeat` is older than 2 hours (stale).
3. If any active lockfile's `areas` matches or is a parent of the file you want to edit → **STOP and warn user**.
4. If no conflict → add the file path to your own lockfile's `areas`, then proceed.
5. After each edit, update `last_heartbeat`.

#### Migration Number Reservation (CRITICAL)
**Never create a migration file without reserving the number first.**
1. Read `.claude/sessions/migrations/next.json` (create if missing by scanning `supabase/migrations/`).
2. Reserve: take `next_available`, write reservation, increment counter.
3. Before writing the `.sql` file, verify: `ls supabase/migrations/ | grep "^NNN_"` — if a file with that number exists, STOP.
4. After committing, clean up your reservation entry.

#### Tier 1 Files — Always Check Locks Before Editing
- `supabase/migrations/*`
- `src/tests/db/helpers.ts`
- `package.json` / `package-lock.json`
- `src/lib/supabase.ts`
- `src/middleware.ts`

#### On Session End
Move your lockfile to `.claude/sessions/completed/` or delete it.

#### Schema Snapshot (MANDATORY after any migration)
`supabase/schema.sql` is the authoritative snapshot of the public schema. CI runs `supabase db diff --linked --schema public` after migrations apply and fails the deploy on any drift — this is the gate that catches silent migration failures (the 231 / 252 incident).
- After creating a new migration, regenerate the snapshot before committing: `npx supabase db dump --linked --schema public --data-only=false > supabase/schema.sql` (staging only — verify `cat supabase/.temp/project-ref` is `zzebptrztuwnqlxxmjuo` first).
- Commit `supabase/schema.sql` in the same commit as the migration. The pre-commit hook warns if you forget; CI will fail the deploy if you push without it.

### Deployment Flow
```
staging (dev + test) → PR to main (requires GitHub approval)
```
- Code: commit to `staging` branch, push, CI runs tests + type-check before deploying
- **Staging deploy pipeline:** tests → type-check → migrations → Vercel auto-deploy → health check (`/api/health`)
- Production: create PR from `staging` → `main`, merge requires manual GitHub environment approval
- Migrations: handled by GitHub Actions deploy workflows — never pushed locally to non-staging environments

### Environment Reference
| Environment | Supabase project ref | Vercel URL | Claude access |
|---|---|---|---|
| Staging | `zzebptrztuwnqlxxmjuo` | `staging.sooq.exchange` | Full (local CLI, can wipe) |
| Production | `dwpizrhtyrquhibqcuuu` | `sooq.exchange` | CI/CD only, NEVER local |

### Vercel
- **Account:** `khaledbaltaji` (Pro plan)
- **Project:** `prediction-market` under `khaledbaltajis-projects`
- **Auto-deploy:** Connected to GitHub — pushes to `staging` trigger preview deploys, `main` triggers production
- **Cron jobs:** `check-errors` (10min), `fetch-news` (10min), `rank-markets` (daily) — requires Pro plan
- **Env vars:** All staging Supabase, Sentry, 3pay, Telegram, and cron secrets are configured

## Bug Resolution Workflows

### Bug on STAGING
- **Access:** Full — local CLI, direct code changes, migrations via `supabase db push`
- **Flow:** Reproduce → Fix locally → Run tests → Commit → Push (after user approval)
- **Risk:** Low — dev environment only

### Bug on PRODUCTION / LIVE
- **Access:** ZERO direct access. Investigation only through logs, Sentry, user reports.
- **Flow:** Investigate → Reproduce on staging → Fix on staging → PR staging → main (requires GitHub approval)
- **NEVER:** Link to production Supabase, push to main directly, run SQL against production
- **Emergency:** Even for "hotfix NOW" — still go staging → main. User must approve each step.

## New Feature Development Flow

When user discusses a new feature, Claude MUST follow this workflow:

### Phase 1: Understand Before Building
1. **Read the architecture** — Before anything else, read: `CLAUDE.md`, `docs/ARCHITECTURE.md` (system bible), `docs/build-plan-v3.md`, `docs/commission-model.md` (if touching money/fees), memory files
2. **Explore impacted areas** — Search codebase for files/functions the feature would touch
3. **Ask questions** — If the feature might impact existing workflows (trading, commissions, resolution, deposits), ASK before proceeding
4. **Map dependencies** — List affected Postgres functions, tables, frontend pages, and tests

### Phase 2: CEO Review (`/ceo`)
- Only after Phase 1 is complete
- Business impact, user experience, scope

### Phase 3: Engineering Review (`/engineering`)
- Technical plan: files to modify, new migrations, test changes
- Security implications, blast radius

### Phase 4: Implementation
- Work on `staging` branch only
- Follow all operational rules
- Update tests alongside code changes

## Test Suite

### Test Files (`src/tests/`)
| File | Tests | What it covers |
|---|---|---|
| `db/place-bet.test.ts` | 9 | `execute_trade` — buy/sell, pricing, limits, closed markets |
| `db/resolve-market.test.ts` | 6 | `resolve_market`, `void_market` — payouts, voiding |
| `db/commission.test.ts` | 10 | Multi-level commissions, tier upgrades, clawback, activation gate |
| `db/deposit-withdrawal.test.ts` | 12 | `process_deposit/withdrawal`, idempotency, bonus, race conditions, concurrency |
| `db/payout-invariants.test.ts` | 7 | Math: ledger consistency, no negative balances, resolution fees, stress test |
| `db/race-conditions.test.ts` | 7 | Concurrent trades, double-deposit, rate limiting, parallel operations |
| `db/agent-wallet.test.ts` | 5 | Agent wallet transfers, balance checks, commission segregation |
| `db/admin-credit.test.ts` | 8 | Admin credit/debit, PIN protection, frozen users, audit log |
| `format-utils.test.ts` | 13 | `formatCurrency`, `formatPercentage`, date/number formatting utils |

### Test-Migration Sync Rules
- **Column add/remove** on core tables → update `helpers.ts` + affected tests
- **RPC signature change** → update corresponding test file immediately
- **New RPC function** → create test file with min 3 cases (happy, edge, error)
- **Fee logic changes** → update `commission.test.ts` + `payout-invariants.test.ts`

## Services & Subscriptions

### Supabase (Backend)
- **What:** Database (Postgres), Auth, Realtime, Edge Functions, Storage
- **Plan:** Free tier (staging) / Pro needed for production
- **Projects:** Staging `zzebptrztuwnqlxxmjuo`, Production `dwpizrhtyrquhibqcuuu`
- **Cost:** Free → $25/mo per project on Pro

### Vercel (Frontend Hosting)
- **What:** Next.js hosting, serverless functions, edge middleware, cron jobs
- **Plan:** Pro (needed for cron + multiple environments)
- **Cost:** $20/mo

### GitHub (Code + CI/CD)
- **What:** Git hosting, Actions (CI/CD), environment secrets, branch protection
- **Repo:** `S-oftware-F-actory/prediction-market` (private)
- **Cost:** Free

### Sentry (Error Monitoring)
- **What:** Error tracking, performance monitoring, session replay, alerting
- **Plan:** Developer (free)
- **Sampling:** `tracesSampleRate: 0.1` (10% in production — reduced from 1.0 during dev)
- **Configs:** `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- **Cost:** Free → Team $26/mo if volume grows

### 3pay (Crypto Payments — PENDING)
- **Status:** Not yet integrated — need merchant account
- **Integration:** `/api/webhook/3pay` route exists, needs credentials

### Whish (Mobile Payments — PENDING)
- **Status:** Not yet integrated — need developer account
- **Integration:** `/api/webhook/whish` route exists, needs credentials

### Domain & DNS — PENDING
- No production domain registered yet

## Monitoring & Alerting

### Logging Stack
- **Logger:** `src/lib/logger.ts` — JSON in production, human-readable in dev. Routes errors/critical to Sentry automatically.
- **Database logs:** `system_logs` table with severity, source, context JSON, admin acknowledgment. Postgres `log_system_event()` for RPCs.
- **Admin dashboard:** `/admin/alerts` (health overview), `/admin/logs` (log viewer with filtering).

### Alerting
- **Slack:** `src/lib/slack.ts` — shared `sendSlackAlert()` utility. Requires `SLACK_WEBHOOK_URL` env var on Vercel.
- **Payment alerts:** 3pay and Whish webhooks send Slack alerts on deposit failures or unresolvable users.
- **Cron monitoring:** `/api/cron/check-errors` runs every 10 min — checks system_logs errors, balance mismatches, and payment/trade failures. Alerts to Slack.
- **Health endpoint:** `/api/health` — checks DB connectivity, table access, returns 503 on degradation.

### Environment Variables (monitoring)
| Variable | Where | Purpose |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Vercel (staging + production) | Slack alerts for errors |
| `STAGING_URL` | GitHub Actions variable | Post-deploy health check |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Vercel | Error tracking |
| `CRON_SECRET` | Vercel | Protects cron endpoints |

## Documentation Maintenance Rules (MANDATORY)
- `docs/ARCHITECTURE.md` is the **SYSTEM BIBLE** — update when adding/changing any flow (trading, deposits, admin, etc.)
- `docs/SCHEMA.md` must be updated when migrations change schema (new tables, columns, RPCs)
- Memory files must be kept current across sessions (build state, go-live checklist)
- New sessions should read `docs/ARCHITECTURE.md` + `CLAUDE.md` for full context before any work
- When shipping a feature, update ARCHITECTURE.md in the same commit — don't leave docs for later

## Key Documents (read in this order for new sessions)
1. `CLAUDE.md` — **YOU ARE HERE.** Operational rules, architecture overview, all constraints.
2. `docs/ARCHITECTURE.md` — **SYSTEM BIBLE.** End-to-end flows for all live subsystems (trading, deposits, admin, realtime, prelaunch, geo, etc.). Support is a WhatsApp deep link only (`NEXT_PUBLIC_SUPPORT_WHATSAPP`).
3. `docs/build-plan-v3.md` — V3 AMM implementation plan (replaces V1).
4. `docs/technical-brief-v3.html` — V3 product spec (AMM model, fee architecture, all features)
5. `docs/commission-model.md` — Canonical commission spec (network-volume tiers, activation gate)
6. `docs/SCHEMA.md` — Complete database schema reference (tables, RPCs, enums, indexes)
7. `docs/admin-panel.md` — Admin panel reference (every page, component, PIN system, audit trail)
8. `docs/decisions.md` — Decision log (what was decided, why, when)
9. `DESIGN.md` — Design system (colors, typography, spacing, motion, states)
10. `docs/review-decisions.md` — All decisions from CEO/Eng/Design/Codex reviews
11. `docs/V1_INVARIANTS.md` — Non-negotiable system invariants (locking, ledger, math purity)
12. `docs/build-plan-v1.md` — V1/V2 implementation plan (historical reference only)
12. `docs/technical-brief-v2.md` — V2 product spec (superseded by V3)

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
