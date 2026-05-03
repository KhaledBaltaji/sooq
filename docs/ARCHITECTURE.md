# Sooq Speed — Architecture

**Last updated:** 2026-05-03 (post W11)
**System:** Sooq Speed — BTC fast-cycle prediction trading
**Migrations:** 16 Drizzle SQL files at `drizzle/migrations/0000`–`0015`
**Status:** Staging live + validated. Production cutover (W12) parked until relaunch.

This is the system bible. Read this after `CLAUDE.md` to understand any flow.

---

## 1. Product

**One product, one asset:** BTC up/down prediction trading on 5m / 15m / 24h durations.

User flow:

1. Sign up via Google OAuth or WhatsApp OTP (VerifyWay)
2. Deposit USD (3pay USDT/USDC or Whish mobile pay)
3. Place a $1–$25 stake on `over` or `under` a strike price
4. Optionally cash out before close (at fair value × time-bucket multiplier)
5. Market closes → 30-second TWAP determines outcome → winners get `stake / entry_offered_prob`, losers zero, push refunds stake
6. Withdraw any time (instant — no 24h hold)

What's NOT in v1: prediction markets (LMSR), branches, multi-level commission, demo mode, prelaunch waitlist, email notifications, deposit bonuses, handle fees, resolution fees.

---

## 2. Stack

| Layer | What | Where |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind + Radix/Base UI | Vercel `sooq` project (Frankfurt edge) |
| API routes | Next.js route handlers under `src/app/api/` | Vercel serverless |
| Auth | Auth.js v5 — Google OAuth + WhatsApp OTP | `app.user_id` GUC pattern + Auth.js sessions in Postgres |
| ORM | Drizzle (`src/lib/db/schema.ts`) + `pg` driver | Direct connection to RDS |
| Database | PostgreSQL 17.9 | AWS RDS `sooq-staging-db`, eu-central-1 |
| Storage | S3 + CloudFront, presigned URLs | `sooq-staging-deposits` (private), `sooq-staging-thumbnails` (public via CloudFront) |
| Oracle | Node.js + WebSocket on EC2 t4g.nano | `i-03411906c55af48af`, eu-central-1a, SG-to-SG path to RDS |
| Cron | `pg_cron` 5s schedule | RDS-side: `speed-roll`, `speed-resolve` |
| Realtime | Polling via TanStack Query | Client-side, intervals 2s–10s |
| OTP delivery | VerifyWay API | External SaaS |
| Errors | Sentry (10% trace sample) | External SaaS |
| Payments in | 3pay (USDT/USDC), Whish (Lebanese mobile) | Webhook → API route |
| i18n | next-intl, en + ar with RTL | Build-time |

---

## 3. Database schema (Drizzle, source of truth in `src/lib/db/schema.ts`)

### Identity

- **`users`** — `id`, `name`, `email`, `email_verified`, `image`, `phone`, `display_name`, `avatar_url`, `bio`, `locale`, `balance_usd`, `is_admin`, `is_frozen`, `admin_allowed_views[]`, timestamps.
- **`accounts`** — Auth.js OAuth provider linkage.
- **`sessions`** — Auth.js sessions.
- **`verification_tokens`** — Auth.js email verification.
- **`otp_verifications`** — `phone`, `code_hash` (SHA-256), `message_id`, `attempts`, `verified`, `expires_at`. Service-role-only writes.

### Money (ledger)

- **`transactions`** — append-only ledger. `user_id`, `type` (enum: `deposit`, `withdrawal`, `speed_stake`, `speed_cashout`, `speed_payout`, `speed_refund`, `admin_credit`, `admin_debit`), `amount`, `balance_after`, `reference_id`, `description`, `performed_by` (admin actions). **Source of truth for balances; `users.balance_usd` is a cache.**
- **`deposits`** — `provider` (`3pay` | `whish`), `provider_ref` (UNIQUE — idempotency), `amount`, `currency`, `status` (`pending` | `verified` | `rejected` | `expired`), `proof_url`, `raw_payload` JSONB.
- **`withdrawals`** — `amount`, `method`, `account_details` JSONB, `status` (`pending` | `approved` | `rejected` | `sent`), `reviewer_id`, `reviewed_at`, `sent_at`, `notes`. **Instant — no 24h hold.**
- **`user_wallets`** — auto-generated TRC-20 / ERC-20 deposit addresses per user.

### Speed mode

- **`speed_assets`** — `id` (e.g. `BTC`), `display_name`, `enabled`. Extensible.
- **`speed_markets`** — `asset`, `duration` (enum), `strike_price`, `opens_at`, `closes_at`, `status` (`open` | `resolving` | `resolved` | `voided`), `outcome` (`over` | `under` | `at_strike`), `twap_at_close`, `void_reason`.
- **`speed_positions`** — user's open / closed position. `user_id`, `market_id`, `side` (`over` | `under`), `stake`, `entry_price`, `entry_fair_prob`, `entry_offered_prob`, `status` (`open` | `won` | `lost` | `cashed_out` | `refunded`), `payout_amount`.
- **`speed_trades`** — every trade event (`open`, `cashout`). `position_id`, `user_id`, `market_id`, `kind`, `amount`, `spot_price`, `fair_prob`, `offered_prob`, `handle_fee` (always 0 post-mig 0013), `cashout_multiplier`, `idempotency_key` (UNIQUE per user).
- **`speed_settlements`** — final outcome per position at resolution. `position_id` PK, `market_id`, `user_id`, `outcome`, `payout_amount`, `settled_at`.

### Speed telemetry

- **`speed_oracle_latest`** — current price per asset. Single-row cache. Updated 1Hz by oracle worker.
- **`speed_oracle_ticks`** — 1Hz historical price ticks. Used for TWAP at resolution + chart `get_speed_klines` synthesis. Unique index on `(asset, ts, source)` for ON CONFLICT dedupe (mig 0008).

### Notifications

- **`notifications`** — `user_id`, `type`, `title_en` / `title_ar` / `body_en` / `body_ar`, `reference_id`, `read_at`. In-app delivery only (dropdown + `/notifications` page).

### Help center

- **`help_collections`** — `slug` (URL-safe), `title`, `description`, `icon`, `locale`, `sort_order`, `is_published` (mig 0012).
- **`help_articles`** — `collection_id` FK, `slug`, `title`, `content` (markdown), `sort_order`, `is_published`. Auto-touch trigger on UPDATE.

### Config

- **`fee_config`** — key/value table. `fee_type` (e.g. `speed_handle_fee_pct = 0`, `speed_spread_pct = 0.04`, `speed_iv_btc = 0.6`, `speed_oracle_stale_seconds = 2`, 18 cashout multipliers). Read by RPCs at runtime; runtime-tweakable (deploy not required for fee changes).
- **`admin_config`** — admin user PIN setup, MFA state. Mostly legacy — no-PIN admin path (mig 0015) is the primary flow.

---

## 4. Core RPCs (Postgres functions)

All `SECURITY DEFINER`, called from Next.js API routes via `runAs(userId, fn)` which sets the `app.user_id` GUC inside a transaction. RPCs read the GUC via `app.user_id()` to identify the caller.

### Trading

- **`speed_execute_trade(market_id, side, stake, idempotency_key?)`** — places a bet. Locks user + market FOR UPDATE. Validates: master switch, stake range ($1–$25), per-side cap ($200), oracle freshness (≤2s), market open + within window. Computes `fair_prob_over` from BSM normal-CDF, applies +2% half-spread → `offered_prob`. INSERTs `speed_positions` + `speed_trades`, debits `users.balance_usd`, INSERTs `transactions` (`type='speed_stake'`). Idempotency keyed on `(idempotency_key, user_id)`.
- **`speed_execute_cashout(position_id, idempotency_key?)`** — early exit. Takes `pg_advisory_xact_lock` on the market (mig 0013) to prevent deadlock with resolve. Recalculates fair value, picks multiplier from `fee_config.speed_cashout_<duration>_<role>_<bucket>`, credits user balance, INSERTs `transactions` (`type='speed_cashout'`).
- **`speed_resolve_market(market_id)`** — resolution. `pg_try_advisory_xact_lock` on the market. Computes 30-second TWAP from `speed_oracle_ticks`. Voids if no ticks → refunds all open positions. Else outcome = `over`/`under`/`at_strike`. Winners get `stake / entry_offered_prob`, losers zero, push refunds stake. INSERTs `speed_settlements`. Returns `{ winners, losers, refunded, total_paid, twap, outcome }`.

### Money

- **`process_deposit(user_id, amount, currency, provider_ref, provider)`** — webhook handler. Idempotent on `provider_ref` (UNIQUE constraint). Credits `users.balance_usd` + INSERTs `transactions`.
- **`process_withdrawal(amount, method, account_details)`** — user-initiated. Locks user, balance check, debits immediately (no hold), INSERTs `withdrawals` + `transactions`.

### Admin (mig 0015 — no-PIN, GUC-gated)

- **`get_admin_withdrawals(status, limit, offset)`** — list pending/approved/rejected/sent for the queue UI.
- **`admin_approve_withdrawal(withdrawal_id, notes)`** — `pending → approved`.
- **`admin_reject_withdrawal(withdrawal_id, notes)`** — refunds the held debit + `pending → rejected`.
- **`admin_mark_withdrawal_sent_v2(withdrawal_id, external_reference, notes)`** — `approved → sent`.

Older PIN-gated equivalents (`admin_review_withdrawal`, `admin_mark_withdrawal_sent`) still exist alongside (don't break anything that calls them).

### Stats (mig 0015)

- **`get_stats_market_pnl(from, to, duration)`** — per-market platform P&L. Returns stakes_in, payouts_out, platform_net, cashout_premium, winner/loser/refunded counts.
- **`get_stats_user_pnl(limit, sort)`** — top users by `winners` (best net P&L), `losers` (worst), or `volume` (total stakes wagered).
- **`get_stats_revenue_summary(from, to)`** — single-row aggregate: gross_volume, total_payouts, platform_net, cashout_premium_total, open_cash_pool, markets_resolved/voided, unique_traders.

### Help center (mig 0012)

- Nothing PG-side beyond the auto-touch trigger. CRUD goes through Drizzle queries from API routes.

### Cron-triggered (via `pg_cron` every 5s)

- **`speed_roll_markets()`** — creates next-cycle speed markets at clean boundaries. Skips if open future market exists. Strike captured from tick-at-`opens_at` (mig 0014), not the live oracle. `_next_clean_boundary` has 30s post-boundary tolerance (mig 0011) to avoid 5-minute "no active market" gaps.
- **`speed_resolve_expired_markets()`** — wraps `speed_resolve_market` for batch use. Per-market errors swallowed via EXCEPTION block.

### Auth

- **`app.user_id()`** — reads `current_setting('app.user_id', true)::uuid`. Set by `runAs()` helper in `src/lib/db/run-as.ts` before every RPC call.

### Math helpers

- **`speed_fair_prob_over(spot, strike, seconds_left, iv)`** — BSM-style normal CDF. `seconds_left = GREATEST(seconds_left, 1.0)`. Guards `LN(0)` if spot or strike ≤ 0 (mig 0013) — returns 0.5.
- **`speed_time_bucket(seconds_total, seconds_left)`** — `high`/`mid`/`low` based on % time left.
- **`normal_cdf(x)`** — Abramowitz & Stegun approximation.

---

## 5. End-to-end flows

### Signup

**Google OAuth path:**

1. User taps "Sign in with Google"
2. Redirect to Google → callback to `/api/auth/[...nextauth]/route.ts`
3. Auth.js validates → upserts `users` row + `accounts` row + creates `sessions` row → cookie set

**WhatsApp OTP path:**

1. User enters phone → `POST /api/auth/send-otp`
2. Backend generates 6-digit code, hashes (SHA-256), stores in `otp_verifications`, calls VerifyWay API to deliver via WhatsApp
3. User enters code → `POST /api/auth/verify-otp` → verifies hash, marks `verified=true`, upserts `users` row + creates session

### Speed trade (open)

1. Frontend: `useSpeedExecuteTrade()` hook → `POST /api/speed/trade` with `{ market_id, side, stake, idempotency_key }`
2. API route: `requireUserApi()` → `runAs(userId, tx => tx.execute(sql\`SELECT speed_execute_trade(...)\`))`
3. Postgres:
   - Idempotency check on `speed_trades.idempotency_key`
   - Master kill switch (`fee_config.speed_markets_enabled`)
   - Lock `users` FOR UPDATE → frozen check + balance check
   - Lock `speed_markets` FOR UPDATE → status + close-time check
   - Oracle freshness check (`speed_oracle_latest.received_at` within `speed_oracle_stale_seconds`)
   - Stake range + per-side cap
   - Pricing: `speed_fair_prob_over(spot, strike, time_left, iv)` + `+spread/2` → `entry_offered_prob`
   - INSERT `speed_positions`, INSERT `speed_trades`, UPDATE `users.balance_usd -= stake`, INSERT `transactions`
4. Returns `{ position_id, trade_id, payout_if_won, ... }`

### Cashout

1. Frontend: `useSpeedCashout()` hook → `POST /api/speed/cashout`
2. RPC `speed_execute_cashout(position_id, idempotency_key)`
3. Postgres:
   - `pg_advisory_xact_lock(hashtext('speed_resolve_<market_id>'))` — serializes with resolve
   - Lock position FOR UPDATE → status check
   - Lock user FOR UPDATE
   - Lock market FOR UPDATE → still open + before close
   - Oracle freshness check
   - Recompute `fair_prob_side` for current time-left
   - Determine winner/loser role + time-bucket → look up multiplier
   - `cashout = stake + fair_profit × multiplier` (winner) or `fair_value × multiplier` (loser)
   - UPDATE position to `cashed_out`, INSERT `speed_trades` (kind='cashout'), credit user, INSERT `transactions`
4. Returns `{ cashout_amount, payout, role, bucket, multiplier }`

### Resolution

1. `pg_cron` fires `speed_resolve_expired_markets()` every 5 seconds
2. For each `closes_at <= NOW()` market with `status IN ('open', 'resolving')`:
   - Acquire `pg_try_advisory_xact_lock(hashtext('speed_resolve_<market_id>'))` — skip if another invocation has it
   - Compute 30-sec TWAP from `speed_oracle_ticks` between `closes_at - 30s` and `closes_at`
   - If 0 ticks → void path: refund all open positions, void market
   - Else: outcome = `over` if TWAP > strike, `under` if <, `at_strike` if =
   - For each open position: settle (winner / loser / push) → INSERT `transactions`, UPDATE `speed_positions.status`, INSERT `speed_settlements`
   - UPDATE `speed_markets.status = 'resolved'` + `outcome` + `twap_at_close` + `resolved_at`

### Deposit (3pay or Whish)

1. User initiates payment via 3pay UI (external) or Whish (uploads receipt)
2. **3pay:** webhook → `/api/webhook/3pay` → HMAC validation → `process_deposit(...)` → INSERT `deposits` (status `verified`) → UPDATE `users.balance_usd` → INSERT `transactions` → INSERT `notifications`
3. **Whish:** receipt uploaded to S3 (presigned URL) → admin reviews at `/admin/withdrawals` (yes, in the same review surface) — actually reviewed in deposits queue admin UI → admin approves → `process_deposit` → balance credited

### Withdrawal

1. User taps "Withdraw" → `/transactions/withdraw` page
2. Frontend calls `POST /api/withdrawal/process` → `process_withdrawal(amount, method, account_details)`:
   - Lock `users` FOR UPDATE, balance check
   - INSERT `withdrawals` (status `pending`)
   - DEBIT `users.balance_usd` immediately (no hold)
   - INSERT `transactions` (`type='withdrawal'`, negative amount)
3. Admin opens `/admin/withdrawals`, sees pending row, clicks Approve → `POST /api/admin/withdrawals/[id]/approve` → `admin_approve_withdrawal(...)` (no PIN, GUC-gated)
4. Admin executes the transfer externally (3pay / Whish / wire), then clicks Mark Sent with the external reference → `admin_mark_withdrawal_sent_v2(...)`
5. If rejected: `admin_reject_withdrawal(...)` refunds the held debit via INSERT `transactions` (`type='admin_credit'`)

---

## 6. Security model

- **Auth.js JWT → app.user_id GUC.** Every API route extracts user from session, calls `runAs(userId, fn)` which sets `SET LOCAL app.user_id = '<uuid>'` in a transaction. Postgres `app.user_id()` reads from session GUC.
- **`SECURITY DEFINER` RPCs trust the GUC, NOT request params.** User-supplied user_id is ignored; RPCs always call `app.user_id()`.
- **`SELECT FOR UPDATE`** on user / market / position rows in every balance-mutating RPC. Prevents double-spend and serializes concurrent trades on the same market.
- **`pg_advisory_xact_lock`** on cashout vs resolve — prevents deadlock window where cashout holds position+user and waits on market while resolve holds market and waits on position.
- **Append-only `transactions`** is the source of truth. `balance_usd` is derived (cached). `scripts/w10-ledger-audit.mjs` reconciles cache vs `SUM(transactions)` and asserts every balance write has a paired tx row. Currently 0 issues across all production paths.
- **Idempotency keys** on `speed_trades` (composite UNIQUE on `(user_id, idempotency_key)`) and `deposits.provider_ref` (UNIQUE) prevent duplicate writes on retries.
- **Frozen accounts** — `users.is_frozen = true` blocks all balance-mutating RPCs.
- **Admin auth.** Two paths coexist:
  - **No-PIN (current, mig 0015):** `is_admin = true` flag checked via `app.user_id()` GUC. All new admin endpoints use this path.
  - **PIN-gated (legacy):** bcrypt PIN in `admin_config` with attempt limits. Older `admin_review_withdrawal` etc. still use it. New code should NOT add PIN-gated RPCs.

---

## 7. Environments

| Env | Frontend | DB | Oracle | Access |
|---|---|---|---|---|
| **Local dev** | `next dev` on `localhost:3000` | RDS staging via `.env.local` | EC2 worker (shared) | Full |
| **Staging** | `staging.sooq.exchange` (Vercel `sooq` project) | `sooq-staging-db` RDS (`db.t4g.medium`, single-AZ) | EC2 `i-03411906c55af48af` | Full |
| **Production** | NOT YET — `sooq.exchange` still on prediction-market | — | — | parked |

**Region:** `eu-central-1` (Frankfurt). Bahrain `me-south-1` was first choice for latency but blocked by Lebanese ISP (the user couldn't reach the Bahrain endpoint).

**Domain ownership:** `staging.sooq.exchange` is aliased to the latest Ready deploy on the new `sooq` Vercel project. Apex `sooq.exchange` and `www.sooq.exchange` are still on the old `prediction-market` Vercel project — they'll move at W12 cutover when Khaled greenlights launch.

See `docs/AWS_RESOURCES.md` for every infrastructure ID (RDS endpoint, EC2, S3 buckets, CloudFront distribution, IAM users, security groups, key pairs, Secrets Manager ARNs).

---

## 8. CI / CD

- **Pre-commit hook:** `npx tsc --noEmit` (blocks commits with type errors)
- **Pre-push hook:** blocks direct pushes to existing `main` (allows first-push to new branches). NO test suite runs (Khaled hasn't asked for it yet).
- **GitHub Actions:** none active. The pre-commit + Vercel build are the gates.
- **Vercel build** runs `npm run build` on every push to `staging`. Deploy URL goes to `sooq-<id>-khaledbaltajis-projects.vercel.app`. Manual `vercel alias set <url> staging.sooq.exchange` re-points the staging domain.

Future (W12+): GitHub environment approval gate for `staging → main`. Drizzle migration apply step in a deploy workflow.

---

## 9. Repo paths

```
src/
├── app/
│   ├── (app)/         # User-facing routes
│   │   ├── page.tsx                    # Home — speed market hero + grid + xl right sidebar
│   │   ├── speed/[id]/page.tsx         # Speed market detail
│   │   ├── markets/page.tsx            # All markets (status + duration filters)
│   │   ├── help/                       # Public help center (3 routes)
│   │   ├── profile/page.tsx            # User profile + P&L chart + tabs
│   │   ├── settings/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── transactions/{deposit,withdraw,page.tsx}
│   │   └── terms, privacy
│   ├── (auth)/        # Login + verify
│   ├── admin/         # 8 surviving admin pages
│   │   ├── page.tsx                    # Dashboard KPIs
│   │   ├── stats/page.tsx              # NEW (W11): per-market + user P&L + KPIs
│   │   ├── withdrawals/page.tsx        # NEW (W11): pending/approved/history queue
│   │   ├── speed/page.tsx              # Slim placeholder (W7 strip)
│   │   ├── users, fees, admins
│   │   └── help/                       # Help CRUD (collections + articles)
│   └── api/
│       ├── auth/                       # Auth.js [...nextauth] + send-otp + verify-otp
│       ├── speed/                      # markets, oracle, trade, cashout, positions, klines, price-history, volatility
│       ├── admin/
│       │   ├── withdrawals/{list,[id]/{approve,reject,mark-sent}}/route.ts  # W11
│       │   ├── stats/{market-pnl,user-pnl,revenue-summary}/route.ts          # W11
│       │   ├── balance, users, help/{collections,articles}, sidebar-counts
│       ├── help/                       # Public reads (collections, articles)
│       ├── webhook/{3pay,whish}        # Payment webhooks
│       ├── wallet, withdrawal, transactions, notifications
│       ├── balance-history, fees
│       ├── users/{me, profile}
│       ├── storage/{upload-url, view-url}
│       └── health
├── components/
│   ├── admin/                          # admin-sidebar + withdrawals-client + stats-client + help forms + delete-help-item
│   ├── auth/, layout/, locale/, profile/, providers/
│   ├── speed/                          # speed-home-view + speed-market-content + speed-hero-card + speed-price-chart + ...
│   ├── wallet/                         # deposit + withdraw modals
│   ├── help/                           # CollectionCard
│   └── ui/                             # primitives + skeletons + avatars
├── hooks/                              # Speed mode + auth + balance + transactions + notifications
├── i18n/messages/                      # en.json + ar.json (with market.* + trade.* namespaces)
├── lib/
│   ├── db/{schema.ts,index.ts,run-as.ts}   # Drizzle source of truth
│   ├── auth/                           # Auth.js handlers + requireAdmin + requireAdminApi
│   ├── verifyway.ts                    # WhatsApp OTP integration
│   ├── help-utils.ts, support-whatsapp.ts, ...
└── tests/                              # Inherited; not maintained against slim schema yet

drizzle/
├── migrations/                         # 16 SQL files (0000–0015)
└── meta/_journal.json                  # Drizzle migrate journal — synced with __drizzle_migrations on RDS

services/speed-oracle/                  # Standalone oracle worker — runs on EC2
├── src/index.ts, package.json, README.md

scripts/
├── apply-*.mjs                         # Migration appliers (one per major mig)
├── w9-*.mjs                            # Validation suites (trade, load, latency)
├── w10-*.mjs                           # Audit + cleanup helpers
├── w11-*.mjs                           # Test-user wipe etc.
├── make-admin.mjs                      # Grant super-admin to an email
├── apply-rds-migrations.sh             # Bulk apply
└── hooks/                              # pre-commit (tsc), pre-push (block main)

docs/
├── ARCHITECTURE.md                     # this file
├── SPRINT_LOG.md                       # rebuild progress W1 → W11
├── AWS_RESOURCES.md                    # every AWS ID
├── STRIP_NOTES.md                      # W3 surgery notes
├── speed-runbook.md                    # speed mode ops
└── ICONS.md                            # icon conventions

drizzle.config.ts
.claude/sessions/                       # multi-session locks + migration reservations
```

---

## 10. Revenue model

Locked in W11 with Khaled. See `CLAUDE.md` § "Revenue model" for the policy table.

**Per-market accounting:** `platform_net = stakes_in − payouts_out`. The 4% AMM spread baked into `offered_prob` and the cashout premium fall out as the platform's edge. Loser stakes flow into the cash pool that funds winner payouts — they are NOT direct revenue.

**Internal categories** (used in `/admin/stats` UI labels):

- **Spread revenue** — captured at trade open via `offered_prob > fair_prob`
- **Cashout premium** — captured on early exits via `multiplier < 1`
- **Platform commission** — sum of the two (= `platform_net` on resolved markets)
- **Cash pool** — sum of open positions' stakes (held funds, not yet revenue)

Stats RPCs in mig 0015 expose these via `get_stats_market_pnl` (per-market), `get_stats_user_pnl` (per-user leaderboard), `get_stats_revenue_summary` (aggregate KPIs).

---

## 11. Phase roadmap

| Phase | Goal | Status |
|---|---|---|
| W1 | Setup new repo, copy codebase, basic CI | ✓ |
| W2 | Strip LMSR + demo + prelaunch + stale features + admin tooling | ✓ |
| W3 | Strip branches + commission + speed_branches | ✓ |
| W4 | Speed RPCs retail-only + admin slim + Drizzle foundation | ✓ |
| W5 | AWS infra (RDS, S3, CloudFront, IAM) | ✓ |
| W6 | Auth.js + GUC pattern + WhatsApp OTP port + Google OAuth | ✓ |
| W7-W8 | Service migration: Drizzle replaces supabase-js, S3 storage, polling, oracle on EC2 | ✓ |
| W9 | Speed-specific AWS validation (pg_cron precision, TWAP, exposure caps under load, latency benchmarks) | ✓ |
| W10 | Cron gap fix, /api/health parallelize, ledger audit, drizzle journal backfill, test-user wipe | ✓ |
| W11 | Home rebuild, help system, /markets, fee lock-in (mig 0013–0014), chart accuracy, admin withdrawals + stats (mig 0015) | ✓ |
| **W12** | **Production cutover — DNS swap, freeze old prediction-market repo. PARKED until Khaled greenlights relaunch.** | parked |

Plan + sub-plans: `~/.claude/plans/oh-my-how-much-giggly-crystal.md`.

---

## 12. Operational gaps + future work

- **Lean ops rebuild** — `system_logs` successor + balance-drift detection cron + alert routing. Scheduled before launch but not started. Sentry alone is the current eye.
- **E2E test suite** — none. Khaled said "I'll add tests when I tell you to add them." Validation today is the W9 scripts + ad-hoc browser smokes.
- **Production AWS** — not yet provisioned. W11 created the staging stack only. Production multi-AZ RDS, separate IAM roles, separate buckets — all comes at W12 launch.
- **Oracle redundancy** — single EC2 worker is a SPOF. Acceptable for staging, will add a second worker + leader election for production.
- **Migration squash** — 16 Drizzle migrations is fine for now. Squash to a single `0000_init.sql` if the count grows unwieldy.
- **/admin/finance** — was deleted in W2 strip. The `withdrawals` page redirected here pre-W11; we replaced the redirect with a real page. The directory itself is gone.
- **Inherited test files** in `src/tests/` reference Supabase test infra that's gone. They don't run. Will be rewritten or deleted in the dedicated test phase.
