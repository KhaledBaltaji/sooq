# CLAUDE.md — Sooq Speed

## Project Overview

**Sooq Speed** — real-money BTC fast-cycle prediction trading for the MENA region. Single-product fintech: users predict BTC up/down on 5m / 15m / 24h durations. TWAP-resolved, oracle-fed, instant withdrawals.

Forked from `prediction-market` (LMSR + branches + commission) on 2026-05-02. Stripped to speed-only in W2/W3/W4 of the rebuild plan (`~/.claude/plans/oh-my-how-much-giggly-crystal.md`).

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind + Radix/Base UI
- **Backend DB:** PostgreSQL (Supabase locally for now; **AWS RDS PostgreSQL in W5+**)
- **ORM:** Drizzle (`src/lib/db/schema.ts`) + `pg` driver — replacing `supabase-js` data layer in W7
- **Auth:** Auth.js v5 (W6 onward) — Google OAuth + WhatsApp OTP via VerifyWay
- **Hosting:** Vercel (frontend + API routes)
- **Storage:** S3 + CloudFront (W7 onward)
- **Payments:** 3pay (USDT/USDC) + Whish (Lebanese mobile)
- **Errors:** Sentry
- **i18n:** next-intl, bilingual (Arabic + English, RTL)

## Architecture (post-strip)

- **Speed mode only.** No LMSR markets, no demo, no prelaunch, no branch network, no multi-level commission.
- All money flow through `users.balance_usd` + `transactions` ledger (append-only). Source of truth is `SUM(transactions)`; `balance_usd` is a cache.
- Speed RPCs (`speed_execute_trade`, `speed_execute_cashout`, `speed_resolve_market`) live in Postgres as `SECURITY DEFINER` functions, called via Drizzle's `sql\`SELECT * FROM ...\`` (post-W7) or `supabase.rpc()` (pre-W7).
- pg_cron runs `speed_resolve_market`, `speed_roll_markets`, partition extension every minute.
- Oracle (TWAP from external book) feeds `speed_oracle_latest` and `speed_oracle_ticks`.
- Auth: Auth.js issues JWT → Next.js API route extracts user → sets `app.user_id` Postgres GUC on every connection → RPCs use `app.user_id()` (W6 swap from `auth.uid()`).
- Notifications: in-app only (`notifications` table + dropdown). No email infra.

## Speed Mode Specifics

- Assets: BTC only at launch; `speed_assets` table is extensible.
- Durations: `5m`, `15m`, `24h` (enum `speed_duration`).
- Stake range: $1–$25 per bet (hardcoded retail caps), $200 cap per side per market.
- Pricing: `fair_prob_over` from BSM-ish formula (oracle price, strike, time-left, IV) + half-spread offset.
- Resolution: 30-second TWAP window before close. Voids if no oracle ticks. `at_strike` is a push (refund).
- Cashout: while market open, with multiplier from `fee_config` indexed by `duration × winner|loser × time-bucket`.

## Commission, Branches, Agents — STRIPPED

These existed in prediction-market and are NOT in Sooq Speed v1:
- Multi-level commission (4 tiers × 2 layers + activation gate)
- Branch network / agents / branch operators
- Referral chain tracking
- Reseller pool ledger

Re-add in a later phase if growth needs it. Plan via a separate spec, not by un-stripping.

## Environments

| Env | Frontend | DB | When provisioned |
|---|---|---|---|
| **Local** | `next dev` on `localhost:3000` | Docker Postgres | Dev workstation |
| **Staging** | `staging.sooq.exchange` (Vercel preview) | RDS small (`db.t4g.medium`) | W5 |
| **Production** | `sooq.exchange` (Vercel) | RDS multi-AZ (`db.t4g.large`+) | W11 just before canary |

Region: `eu-central-1` (Frankfurt). Originally targeted `me-south-1` (Bahrain) for Lebanese-user latency but the user's ISP couldn't reach the Bahrain AWS endpoint (timeout). Frankfurt is the next-closest viable region with full service catalog.

## Operational Rules (MANDATORY)

### FORBIDDEN
1. **NEVER** run destructive SQL (`TRUNCATE`, `DROP TABLE` without `IF EXISTS`, `DELETE FROM` without `WHERE`) against staging or production without explicit user approval.
2. **NEVER** force push (`git push --force`) to `main`.
3. **NEVER** push directly to `main`. Production changes flow only through PRs: `staging` → `main`.
4. **NEVER** display or log production database credentials.
5. **NEVER** create AWS accounts or enter financial info on the user's behalf — always direct the user to do this themselves.
6. **NEVER** type access keys / passwords / OTP codes — the user pastes credentials into prompts themselves.

### REQUIRED
1. **ALWAYS** run `npx tsc --noEmit` and `npm run lint` before committing to `staging`.
2. **ALWAYS** ask user for explicit confirmation before: pushing to any remote branch, creating/merging PRs, running migrations against staging or production, running any SQL against a remote database.
3. **ALWAYS** update `docs/SPRINT_LOG.md` at phase boundaries during the rebuild sprint.

### Multi-Session Safety

This repo can be edited by multiple Claude Code sessions. Follow `.claude/sessions/` rules:
1. On session start, create `.claude/sessions/locks/<YYYYMMDD-HHMMSS-XXXX>.json` with `session_id`, `started_at`, `description`, `areas`, `migrations_reserved`, `last_heartbeat`.
2. Before editing a file, check `.claude/sessions/locks/` for conflicting active locks (heartbeat < 2 hrs old).
3. Before creating a migration file, reserve the number in `.claude/sessions/migrations/next.json`.
4. On session end, move your lockfile to `.claude/sessions/completed/`.

## Deployment Flow

```
local Docker PG  →  staging branch  →  PR to main  →  production deploy
```

- **Local:** `next dev`, Docker Postgres, free
- **Staging:** push to `staging` branch → Vercel preview → CI runs tests + type-check → Drizzle migrations apply automatically (W5+)
- **Production:** PR `staging → main` → manual GitHub environment approval → Vercel production deploy

## Tests

Surviving test files (16) in `src/tests/`:
- `db/admin-credit.test.ts`, `db/admin-fee-bounds.test.ts`, `db/admin-roles.test.ts`
- `db/deposit-withdrawal.test.ts`, `db/submit-manual-deposit.test.ts`
- `db/speed-*.test.ts` (10 files — invariants, smoothing, exposure caps, idempotency, late window, pool concurrency, pricing, roll markets, strike finalize, twap boundary)
- `db/helpers.ts`

LMSR / demo / branch / commission tests were deleted in W2/W3 strip phases.

## Repo Layout

| Path | What's there |
|---|---|
| `src/app/(app)/` | User-facing routes — speed market detail, profile, notifications, settings, transactions, terms, privacy |
| `src/app/admin/` | 5 surviving admin pages — page, speed, users, withdrawals, fees, admins |
| `src/app/api/` | Webhooks (3pay, Whish), auth (send-otp, verify-otp), speed crons (roll, resolve, partitions), wallet, deposit, internal log-error, health |
| `src/components/` | UI primitives + admin/auth/feed/help/layout/locale/profile/providers/speed/wallet/icons |
| `src/hooks/` | Speed mode + auth + balance + transactions hooks |
| `src/lib/db/schema.ts` | Drizzle schema — single source of truth post-W7 |
| `src/lib/auth/`, `src/lib/supabase/` | Auth helpers (W6 will rewrite for Auth.js) |
| `src/lib/verifyway.ts` | WhatsApp OTP integration via VerifyWay |
| `supabase/migrations/` | 366 SQL migrations (squash candidate for W7) |
| `docs/` | ARCHITECTURE.md (system bible), SPRINT_LOG.md (rebuild log), STRIP_NOTES.md (W3 surgery notes), speed-runbook.md, ICONS.md |
| `.claude/sessions/` | Multi-session locks + migration reservations (gitignored) |

## Key Documents (read in this order for new sessions)

1. **`CLAUDE.md`** — you are here. Operational rules, architecture overview, constraints.
2. **`docs/ARCHITECTURE.md`** — system bible. End-to-end flows for speed mode, money, auth, notifications.
3. **`docs/SPRINT_LOG.md`** — rebuild progress (W1–current). Read latest entry to know where work stands.
4. **`~/.claude/plans/oh-my-how-much-giggly-crystal.md`** — the 12-week rebuild plan. Phase-by-phase goals, decisions, risks.
5. **`docs/STRIP_NOTES.md`** — coupling map for the speed RPCs that were surgically rewritten in W4.
6. **`DESIGN.md`** — design system (colors, typography, spacing, motion).
7. **`docs/ICONS.md`** — icon conventions (lucide-react only).
8. **`docs/speed-runbook.md`** — speed mode operational notes.

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Examples:
- Bug investigation → `investigate`
- Ship / deploy / push / create PR → `ship`
- QA / test the site / find bugs → `qa`
- Code review / check my diff → `review`
- Update docs after shipping → `document-release`
- Visual audit / design polish → `design-review`
- Architecture review → `plan-eng-review`
