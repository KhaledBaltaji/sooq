# CLAUDE.md — Sooq Speed

## Project Overview

**Sooq Speed** — real-money BTC fast-cycle prediction trading for the MENA region. Single-product fintech: users predict BTC up/down on 5m + 1h durations. Exact-tick settlement with wick-detector safety net (mig 369), oracle-fed, instant withdrawals. Forked from `prediction-market` (LMSR + branches + commission) on 2026-05-02 and stripped + rebuilt over W1–W11. Casino-mode pricing/cashout overhaul landed in mig 369.

**Current state:** AWS staging is live at `staging.sooq.exchange`. RDS PostgreSQL + Auth.js + EC2 oracle worker + S3/CloudFront all wired and validated. Speed RPCs ship trades end-to-end (W9 trade-suite passes 22/22). Admin withdrawals queue + stats dashboard landed in W11. Production cutover is parked until Khaled gives the go.

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind + Radix/Base UI
- **Database:** PostgreSQL 17.9 on AWS RDS (`sooq-staging-db`, eu-central-1)
- **ORM:** Drizzle (`src/lib/db/schema.ts`) + `pg` driver — sole data layer
- **Auth:** Auth.js v5 — Google OAuth + WhatsApp OTP via VerifyWay; `app.user_id` GUC pattern for SECURITY DEFINER RPCs
- **Hosting:** Vercel (frontend + API routes, Frankfurt edge)
- **Storage:** S3 + CloudFront (`d36u9ggi9no1rl.cloudfront.net`) with presigned URLs
- **Oracle worker:** Node.js + WebSocket on AWS EC2 t4g.nano (`i-03411906c55af48af`), Binance BTC/USDT 1s klines → `pg` → RDS
- **Cron:** `pg_cron` 5s schedule (`speed-roll`, `speed-resolve`); Vercel cron for HTTP routes
- **Realtime:** Polling via TanStack Query (no WebSocket subscriptions)
- **Payments:** 3pay (USDT/USDC) + Whish (Lebanese mobile pay)
- **Errors:** Sentry (10% trace sample)
- **i18n:** next-intl, bilingual (Arabic + English, RTL)

## Architecture (current)

- **Speed mode only.** No LMSR markets, no demo, no prelaunch, no branch network, no commission tree. Stripped in W2/W3.
- **All money flow** goes through `users.balance_usd` (cache) + `transactions` ledger (append-only, source of truth). Every balance write has a paired transaction row — verified by `scripts/w10-ledger-audit.mjs`.
- **Speed RPCs** (`speed_execute_trade`, `speed_execute_cashout`, `speed_resolve_market`) live in Postgres as `SECURITY DEFINER` functions, called from Next.js API routes via `runAs(userId, fn)` which sets the `app.user_id` GUC inside a transaction.
- **pg_cron** runs `speed_roll_markets()` + `speed_resolve_expired_markets()` every 5 seconds. Validated to ±6ms precision under 4-worker concurrent load (W9).
- **Oracle:** EC2 worker streams Binance 1Hz klines via WebSocket, writes to `speed_oracle_ticks` (history) + `speed_oracle_latest` (cache). SG-to-SG private path; same-VPC writes, no public RDS hop.
- **Notifications:** in-app only (`notifications` table + dropdown). No email infra (per locked plan decision).

## Speed Mode Specifics

- **Asset:** BTC only at launch; `speed_assets` table is extensible (room for ETH/SOL etc.)
- **Durations:** `5m`, `1h` (active). The `speed_duration` enum still carries `15m` and `24h` for historical FK integrity, but the trade RPC rejects them at runtime. New markets are 5m + 1h only.
- **Stake range:** $1–$25 per bet (hardcoded retail caps), $200 cap per side per market
- **Pricing:** `speed_fair_prob_over` from BSM-style normal CDF (oracle price, strike, time-left, IV) + half-spread offset (`speed_spread_pct = 0.05`, so +2.5% per side baked into `offered_prob`). Mig 369 raised spread 0.04 → 0.05 (absorbed the deleted phantom handle fee). IV from realized-vol cache (90s freshness) via `_speed_get_iv()`, falls back to `speed_iv_btc`. Spread layers: base + Seam 3 quadratic widening past ±0.45 + 3-tier late-window surcharge (last 60s +20%, last 30s +30%, last 10s reject).
- **Oracle architecture (Group C, 0018):** EC2 worker at `services/speed-oracle/` subscribes to `wss://stream.binance.com:9443/ws/btcusdt@bookTicker` (~200–500 events/sec for BTCUSDT) and writes the top-of-book mid `(best_bid + best_ask)/2` throttled at 10 Hz to `speed_oracle_latest` + `speed_oracle_ticks`. Mid was chosen over @trade prices to eliminate the bid/ask sawtooth that showed up as visible chart bouncing on calm markets — mid is monotonic, no alternation, and is the standard derivatives reference price. Frontend reads via Binance WS DIRECTLY (`useBinanceTicker` → `lib/binance/ws-client.ts` `subscribeBookTicker`) for sub-second chart smoothness; falls back to `/api/speed/oracle` polling if Binance WS unreachable from the user's network. Trade execution + settlement still read `speed_oracle_latest` from the DB inside their RPCs — server is always the source of truth. Chart-side smoothing (Group C): autoscaleInfoProvider with 0.25% min Y-range floor + 0.85 EMA on the displayed range, RAF-coalesced `series.update()`, framer-motion `useSpring` on the live dot. Public health endpoint at `/api/health/oracle` reports oldest tick age; cron at `.github/workflows/oracle-monitor.yml` alerts on >5s staleness. Worker host: EC2 `i-03411906c55af48af` (`63.183.214.217`), systemd unit `speed-oracle.service`. Wick detector threshold tightened 0.003 → 0.0015 in mig 0018 (mid is much quieter than @trade, so tighter manipulation defense without false positives). Stream history: `@kline_1s` (initial) → `@trade` (Group B, mig 0017) → `@bookTicker` mid (Group C, mig 0018).
- **Resolution:** exact oracle tick at-or-before `closes_at` (mig 369; pre-369 used 30s TWAP). Wick detector compares to 5s-before tick — if delta >0.1% (`speed_wick_threshold_pct`), falls back to median-of-last-30-ticks. Voids if no ticks (or wick fallback can't compute). `at_strike` is a push (refund). NO resolution fee — winners get exactly `stake / entry_offered_prob`. Per-market audit row written to `speed_market_settlement_audit`.
- **Cashout:** continuous mark-to-market formula (mig 369): `cashout = stake × (mark_prob / entry_offered_prob) × decay_curve(duration, pct) × liq_discount(seconds_left)`. No winner/loser branch. Decay endpoints in fee_config keyed `speed_cashout_decay_<dur>_<bucket>`. Last 5s rejected entirely (last-tick arbitrage protection).
- **Strike capture:** market's strike is the oracle tick at-or-just-before `opens_at` (mig 0014). Header label and chart price match exactly at the open boundary.
- **Risk caps (mig 369):** per-side 25% of pool collateral, per-user-per-market $200, per-user-daily-wager $500, same-strike-cluster 30% of pool, daily NGR floor -$500 (circuit breaker — halts new entries when settled NGR crosses; cashouts and resolution stay live; auto-resets at UTC midnight). Pool collateral configured via `speed_pool_collateral_usd` ($10k default).
- **IV snapshot pattern:** trade and cashout RPCs accept optional `expected_iv`. If client snapshot drifts >10% from server's `_speed_get_iv()`, RPC returns `IV_DRIFT` so UI can re-render. Closes the quote/execute parity hole around RV cache expiry. IV used is recorded on `speed_trades.iv_used`.

## Revenue model (locked in W11)

| Source | How | Visible to user? |
|---|---|---|
| **AMM spread** | 5% baked into `offered_prob` at trade open (mig 369: was 4%, raised to absorb the deleted phantom handle fee) | Implicit (in the price) |
| **Cashout premium** | Continuous decay × liq_discount on early exits, duration-specific (mig 369). Replaces the old winner/loser × bucket matrix. | Visible — user sees the cashout amount on the button. Fair_value display removed (casino framing — user compares cashout to stake, not to fair_value). |
| **Handle fee** | DELETED (mig 369). Phantom row removed from `fee_config`. `speed_trades.handle_fee` column kept for historical rows; new trades store NULL. | n/a |
| **Resolution fee** | NEVER ADDED. Winners get clean `stake/offered_prob` payout. | n/a |

**Math per market:** `platform_net = stakes_in − payouts_out` (industry-standard AMM accounting). Spread + cashout premium fall out as the platform's edge. Loser stakes flow into the cash pool that funds winner payouts; the loss itself is NOT direct revenue. See `/admin/stats` page.

## Commission, Branches, Agents — STRIPPED

These existed in prediction-market and are NOT in Sooq Speed v1:

- Multi-level commission (4 tiers × 2 layers + activation gate)
- Branch network / agents / branch operators
- Referral chain tracking
- Reseller pool ledger
- Demo mode + prelaunch waitlist
- LMSR markets + AMM state + market_comments + market_news / AI

Re-add in a later phase if growth needs it. Plan via a separate spec, not by un-stripping.

## Migrations

15 Drizzle migrations under `drizzle/migrations/` (0000–0015). Run via `scripts/apply-*.mjs` against RDS. The Drizzle journal (`__drizzle_migrations` table) is in sync with `_journal.json` — backfilled in W11 cleanup.

| File | What |
|---|---|
| `0000_plain_turbo.sql` | Base schema — Auth.js tables + speed_* tables + transactions + users |
| `0001_large_xorn.sql` | Oracle tables + fee_config + admin_config |
| `0002_speed_rpcs.sql` | Speed RPCs (trade, cashout, resolve) + math helpers + `app.user_id` GUC |
| `0003_money_rpcs.sql` | `process_deposit`, `process_withdrawal`, admin review (PIN-gated) |
| `0004_speed_cron.sql` | pg_cron schedule + `speed_roll_markets` + `speed_resolve_expired_markets` |
| `0005_user_wallets.sql` | Crypto wallet management for deposits |
| `0006_admin_rpcs.sql` | Admin role/PIN/balance-adjust + `get_admin_sidebar_counts` |
| `0007_chart_rpcs.sql` | `get_speed_klines`, `get_speed_price_history`, `get_speed_volatility` |
| `0008_speed_oracle_ticks_unique.sql` | Unique index for ON CONFLICT dedupe |
| `0009_speed_trade_enum_fix.sql` | text→speed_side cast fix + seed missing fee_config rows |
| `0010_speed_cashout_multipliers.sql` | 18-row cashout multiplier matrix |
| `0011_cron_gap_and_cashout_shape.sql` | `_next_clean_boundary` tolerance + cashout `payout` alias |
| `0012_help_center.sql` | help_collections + help_articles (admin CRUD content) |
| `0013_drop_handle_fee_and_polish.sql` | Drop handle_fee, void-count fix, LN(0) guard, cashout advisory lock |
| `0014_strike_at_opens_at.sql` | Strike captured from tick-at-opens_at, not live oracle |
| `0015_admin_withdrawals_and_stats.sql` | No-PIN admin withdrawal queue + stats RPCs |

## Environments

| Env | Frontend | DB | Oracle | Access |
|---|---|---|---|---|
| **Local dev** | `next dev` on `localhost:3000` | RDS staging via `.env.local` | EC2 worker (shared) | Full |
| **Staging** | `staging.sooq.exchange` (Vercel sooq project) | `sooq-staging-db` RDS | EC2 `i-03411906c55af48af` | Full |
| **Production** | NOT YET PROVISIONED — old prediction-market still on `sooq.exchange` | — | — | parked until relaunch |

**AWS region:** `eu-central-1` (Frankfurt). Bahrain `me-south-1` was first choice for Lebanese-user latency but blocked by Lebanese ISP. See `docs/AWS_RESOURCES.md` for all infrastructure IDs.

## Operational Rules (MANDATORY)

### FORBIDDEN

1. **NEVER** run destructive SQL (`TRUNCATE`, `DROP TABLE` without `IF EXISTS`, `DELETE FROM` without `WHERE`) against staging without explicit user approval.
2. **NEVER** push directly to `main` (production cutover branch). All changes flow through `staging` and PRs.
3. **NEVER** force-push to `staging` or `main`.
4. **NEVER** display or log database credentials, AWS keys, or session secrets.
5. **NEVER** type access keys / passwords / OTP codes — the user pastes credentials themselves.
6. **NEVER** create AWS / GitHub / Google / Vercel accounts on the user's behalf.
7. **NEVER** touch the live `sooq.exchange` (still on the old `prediction-market` Vercel project) without explicit user approval — the live cutover is parked until relaunch.

### REQUIRED

1. **ALWAYS** run `npx tsc --noEmit` and `npm run build` before committing to `staging`. The pre-commit hook enforces tsc.
2. **ALWAYS** ask user for explicit confirmation before: pushing to any remote branch, creating/merging PRs, applying migrations to RDS staging, running raw SQL against RDS.
3. **ALWAYS** update `docs/SPRINT_LOG.md` at meaningful checkpoints (phase boundaries, big landings, major incident fixes).

### Multi-Session Safety

This repo can be edited by multiple Claude Code sessions. Follow `.claude/sessions/` rules:

1. On session start, create `.claude/sessions/locks/<YYYYMMDD-HHMMSS-XXXX>.json` with `session_id`, `started_at`, `description`, `areas`, `migrations_reserved`, `last_heartbeat`.
2. Before editing a file, check `.claude/sessions/locks/` for conflicting active locks (heartbeat < 2 hrs old).
3. Before creating a migration file, reserve the next number in `.claude/sessions/migrations/next.json`.
4. On session end, move your lockfile to `.claude/sessions/completed/`.

In practice during W6+ Khaled has been working solo, so locks are mostly absent. Still — assume contention and follow the protocol.

## Deployment Flow

```
local (next dev + RDS staging)
        ↓
staging branch on GitHub  →  Vercel auto-build  →  manual `vercel alias` re-point
        ↓                                                         ↓
   tsc + build hooks                                  staging.sooq.exchange
```

- **Local:** `next dev`, RDS staging directly via `DATABASE_URL` in `.env.local`. EC2 oracle is shared (writes go to staging RDS).
- **Staging:** push to `staging` branch → Vercel auto-deploys (~50s). Domain alias is manual: `vercel alias set <new-url> staging.sooq.exchange`.
- **Production:** not yet wired. W12 will move `sooq.exchange` from prediction-market Vercel project to sooq when Khaled green-lights launch.

## Tests

Khaled said in W7 "I will add tests when I tell you to add them." No active test suite. Test files exist under `src/tests/` but they were inherited from prediction-market and are not maintained against the slim Sooq schema. Re-build them in a dedicated phase before launch.

What we do have for validation:

- `scripts/w9-trade-suite.mjs` — 22 invariants of `speed_execute_trade` (master switch, freshness gate, idempotency, stake range, cap saturation, cashout). Passes 22/22.
- `scripts/w9-load-suite.mjs` — concurrency stress test. 4 workers × 20s window. Asserts cap holds + ledger balanced + no orphan trades + cron precision under load.
- `scripts/w9-latency-bench.mjs` — 30-sample p50/p95/p99 against `staging.sooq.exchange`.
- `scripts/w10-ledger-audit.mjs` — full ledger reconciliation (balance cache vs `SUM(transactions)`, orphan checks, settlement coverage). Currently 0 issues.

## Repo Layout

| Path | What's there |
|---|---|
| `src/app/(app)/` | User-facing routes — home (speed feed), `/speed/[id]`, `/markets`, profile, notifications, settings, transactions, terms, privacy, help |
| `src/app/admin/` | Admin pages — dashboard, stats, speed, users, withdrawals, fees, admins, help (CRUD) |
| `src/app/api/` | All API routes — speed (markets, oracle, trade, cashout, positions, klines, price-history), admin (withdrawals, stats, balance, users, help, sidebar-counts), help (public reads), webhooks (3pay, Whish), wallet, withdrawal, transactions, notifications, balance-history, fees, users (me, profile), storage, health, auth |
| `src/components/` | UI primitives + admin / auth / help / layout / locale / profile / providers / speed / wallet / icons |
| `src/hooks/` | Speed mode + auth + balance + transactions + notifications + speed positions/markets/oracle |
| `src/lib/db/` | `index.ts` (pg pool), `schema.ts` (Drizzle source of truth), `run-as.ts` (GUC helper) |
| `src/lib/auth/` | Auth.js handlers + `requireAdmin` server guards + `requireAdminApi` JSON guards |
| `src/lib/verifyway.ts` | WhatsApp OTP integration |
| `drizzle/migrations/` | 16 SQL migrations (0000–0015) — sole source of schema truth |
| `services/speed-oracle/` | Standalone Node.js oracle worker — runs on EC2, separate package |
| `scripts/` | Migration appliers, validation suites (W9), audit scripts (W10), ops helpers (make-admin, wipe-test-users, alias rotators) |
| `docs/` | ARCHITECTURE.md (system bible), SPRINT_LOG.md (rebuild log), AWS_RESOURCES.md (infra IDs), STRIP_NOTES.md, speed-runbook.md, ICONS.md |
| `.claude/sessions/` | Multi-session locks + migration reservations |

## Key Documents (read in this order for new sessions)

1. **`CLAUDE.md`** — you are here. Operational rules, current architecture, constraints.
2. **`docs/ARCHITECTURE.md`** — system bible. End-to-end flows for speed mode, money, auth, notifications, admin.
3. **`docs/SPRINT_LOG.md`** — chronological rebuild log W1 → W11. Read latest entry to know where work stands.
4. **`docs/AWS_RESOURCES.md`** — every AWS resource ID (RDS, EC2, S3, CloudFront, IAM, security groups, key pairs).
5. **`~/.claude/plans/oh-my-how-much-giggly-crystal.md`** — the master plan. Phase-by-phase goals + locked decisions + W11 sub-plans (chart fixes, withdrawals/stats).
6. **`docs/STRIP_NOTES.md`** — coupling map for the speed RPCs that were surgically rewritten in W3/W4.
7. **`DESIGN.md`** — design system (colors, typography, spacing, motion). Read before any UI change.
8. **`docs/ICONS.md`** — icon conventions (lucide-react only).
9. **`docs/speed-runbook.md`** — speed mode operational notes.

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Examples:

- Bug investigation / "why is this broken" / 500 errors → `investigate`
- Ship / deploy / push / create PR → `ship`
- QA / test the site / find bugs → `qa`
- Code review / check my diff → `review`
- Update docs after shipping → `document-release`
- Visual audit / design polish → `design-review`
- Architecture review → `plan-eng-review`
- Product brainstorming / "is this worth building" → `office-hours`
