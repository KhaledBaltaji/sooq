# Sooq Speed — Architecture

**Last updated:** 2026-05-02 (post W4)
**System:** Sooq Speed — BTC fast-cycle prediction trading
**Migrations:** 366 (001–363 inherited from prediction-market, 364–366 are W2/W3/W4 strips + retail rewrites)
**Status:** Mid-rebuild. W1–W4 done locally, W5 (AWS infra) blocked on AWS credentials.

This is the system bible. Read this after `CLAUDE.md` to understand any flow.

---

## 1. Product

**One product, one asset:** BTC up/down prediction trading on 5m / 15m / 24h durations.

User flow:
1. Sign up via Google OAuth or WhatsApp OTP (VerifyWay)
2. Deposit USD (3pay USDT/USDC or Whish mobile pay)
3. Place a $1–$25 stake on `over` or `under` a strike price
4. Optionally cash out before close (at a fair-value-with-multiplier rate)
5. Market closes → 30-second TWAP determines outcome → winners get `stake / entry_offered_prob`, losers zero, push refunds stake
6. Withdraw at any time (instant, no hold)

What's NOT in v1: prediction markets (LMSR), branches, multi-level commission, demo mode, prelaunch waitlist, email notifications, heavy admin tooling.

---

## 2. Stack

| Layer | What | Where |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind + Radix/Base UI | Vercel |
| API routes | Next.js route handlers under `src/app/api/` | Vercel serverless |
| Auth | Auth.js v5 (W6 onward) — Google OAuth + WhatsApp OTP | Stateful via `app.user_id` GUC |
| ORM | Drizzle (`src/lib/db/schema.ts`) + `pg` driver | post-W7 |
| Database | PostgreSQL 17 | RDS (staging W5, production W11) |
| Storage | S3 + CloudFront, presigned URLs | post-W7 |
| Cron | `pg_cron` for speed-resolve / speed-roll / partition extension; Vercel cron for HTTP routes | RDS-side + Vercel |
| Realtime | Polling via TanStack Query (no `supabase.channel()` post-W7) | Client-side |
| OTP delivery | VerifyWay API (`https://api.verifyway.com/api/v1/`) | External SaaS |
| Errors | Sentry | External SaaS |
| Payments in | 3pay (USDT/USDC), Whish (Lebanese mobile) | Webhook → API route |
| i18n | next-intl, en + ar with RTL | Build-time |

---

## 3. Database schema (slim, post-strip)

Drizzle is the source of truth in `src/lib/db/schema.ts`. Major tables:

### Identity
- **`users`** — `id`, `phone`, `display_name`, `avatar_url`, `email`, `bio`, `locale`, `balance_usd`, `is_admin`, `is_frozen`, `admin_allowed_views[]`, timestamps.
- **`otp_verifications`** — `phone`, `code_hash` (SHA-256), `message_id`, `attempts`, `verified`, `expires_at`. Service-role only.

### Money
- **`transactions`** — append-only ledger. `user_id`, `type` (enum: `deposit`, `withdrawal`, `speed_stake`, `speed_cashout`, `speed_payout`, `speed_refund`, `admin_credit`, `admin_debit`), `amount`, `balance_after`, `reference_id`, `description`. **Source of truth for balances.**
- **`deposits`** — `provider` (`3pay` | `whish`), `provider_ref` (unique idempotency), `amount`, `currency`, `status` (`pending` | `verified` | `rejected` | `expired`), `proof_url`, `raw_payload` JSONB.
- **`withdrawals`** — `amount`, `method`, `account_details` JSONB, `status` (`pending` | `approved` | `rejected` | `sent`), `reviewer_id`, `reviewed_at`, `sent_at`, `notes`. **Instant — no 24h hold.**

### Speed mode
- **`speed_assets`** — `id` (e.g. `BTC`), `display_name`, `enabled`. Extensible.
- **`speed_markets`** — `asset`, `duration` (enum), `strike_price`, `opens_at`, `closes_at`, `status` (`open` | `resolving` | `resolved` | `voided`), `outcome` (`over` | `under` | `at_strike`), `twap_at_close`, `void_reason`.
- **`speed_positions`** — user's open position. `user_id`, `market_id`, `side` (`over` | `under`), `stake`, `entry_price`, `entry_fair_prob`, `entry_offered_prob`, `status` (`open` | `won` | `lost` | `cashed_out` | `refunded`), `payout_amount`.
- **`speed_trades`** — every trade event (`open`, `cashout`). `position_id`, `user_id`, `market_id`, `kind`, `amount`, `spot_price`, `fair_prob`, `offered_prob`, `handle_fee`, `cashout_multiplier`, `idempotency_key`.
- **`speed_settlements`** — final outcome per position at resolution. `position_id` PK, `market_id`, `user_id`, `outcome`, `payout_amount`, `settled_at`.

### Speed telemetry (Postgres-side only, not in Drizzle schema yet)
- **`speed_oracle_latest`** — current price per asset.
- **`speed_oracle_ticks`** — historical price ticks (used for TWAP).
- **`speed_external_book_snapshots`** — order book snapshots from external exchanges.
- **`speed_exposure_live`** + **`speed_market_exposure_live`** — exposure tracking for caps.

### Notifications
- **`notifications`** — `user_id`, `type`, `title_en` / `title_ar` / `body_en` / `body_ar`, `reference_id`, `read_at`. In-app delivery only.

### Config
- **`fee_config`** — key/value table. `fee_type` (e.g. `speed_handle_fee_pct`, `speed_spread_pct`, `speed_iv_btc`, `speed_oracle_stale_seconds`, `speed_cashout_5m_winner_early`, etc.), `rate`. **Will be hardcoded into RPCs once values are confirmed.**

### Admin
- **`admin_config`** — admin user PIN setup, MFA state.

---

## 4. Core RPCs (Postgres functions)

All `SECURITY DEFINER`, called via `supabase.rpc()` (pre-W7) or Drizzle's `sql\`SELECT * FROM ...\`` (post-W7). All use `auth.uid()` (pre-W6) or `app.user_id()` (W6 onward).

### Trading
- **`speed_execute_trade(market_id, side, stake, idempotency_key?)`** — places a bet. Locks user + market + oracle, validates stake range + caps, computes `fair_prob_over` from BSM, applies half-spread offset, INSERTs `speed_positions` + `speed_trades`, debits `users.balance_usd`, INSERTs `transactions`. Retail-only post-W4 (no branch routing).
- **`speed_execute_cashout(position_id, idempotency_key?)`** — early exit. Recalculates fair value, applies time-bucket × winner|loser multiplier from `fee_config`, credits user balance, INSERTs `transactions`. Retail-only post-W4.
- **`speed_resolve_market(market_id)`** — resolution. Computes 30-second TWAP from `speed_oracle_ticks`. Voids if no ticks. Otherwise winners get `stake / entry_offered_prob`, losers close at zero, push refunds stake. INSERTs `speed_settlements`. Idempotent via advisory lock + `speed_settlements` PK check.

### Money
- **`process_deposit(...)`** — webhook handler (3pay / Whish). Idempotent on `provider_ref`. Credits `users.balance_usd` + INSERTs `transactions`.
- **`process_withdrawal(...)`** — initiates withdrawal. Debits balance immediately (no hold). Admin reviews via `/admin/withdrawals`.

### Speed admin
- **`admin_create_speed_market(...)`** — creates a future speed market.
- **`speed_admin_master_kill_hard / soft / revive`** — emergency kill switches via `fee_config` flags.
- **`speed_admin_overview()`** — admin dashboard query.

### Cron-triggered (via `pg_cron`)
- **`speed_roll_markets()`** — creates next-cycle speed markets when current ones close.
- **`speed_resolve_expired_markets()`** — wraps `speed_resolve_market` for batch use.
- **`speed_rv_refresh()`** — refreshes realized-volatility cache.
- **`_speed_create_trade_partitions()`** — extends daily speed_trades partitions.

### Auth (W6 onward)
- **`app.user_id()`** — Postgres helper that reads `current_setting('app.user_id', true)::uuid`. Replaces `auth.uid()` everywhere via single `sed`-pass in W6.

---

## 5. End-to-end flows

### Signup (W6 form — current is Supabase Auth)

1. User enters phone OR taps "Sign in with Google"
2. **WhatsApp OTP path:**
   - `POST /api/auth/send-otp` → generates 6-digit code, hashes (SHA-256), stores in `otp_verifications`, calls VerifyWay API to deliver via WhatsApp
   - User enters code → `POST /api/auth/verify-otp` → verifies hash, marks `otp_verifications.verified = true`, creates `users` row + Auth.js session
3. **Google OAuth path:**
   - Redirect to Google → callback to `/api/auth/callback/google` → Auth.js validates → upsert `users` row + session

### Speed trade

1. Frontend: `useExecuteSpeedTrade` hook calls RPC
2. `speed_execute_trade(market_id, 'over', 5.00, idempotency_key)`
3. Postgres:
   - Idempotency check on `speed_trades.idempotency_key`
   - Master kill switch (`fee_config.speed_markets_enabled`)
   - Lock `users` row → frozen check + balance check
   - Lock `speed_markets` row → status + close-time check
   - Oracle freshness check (`speed_oracle_latest.received_at` within `speed_oracle_stale_seconds`)
   - Stake range + per-side cap
   - Pricing: `speed_fair_prob_over(spot, strike, time-left, iv)` + half-spread → `entry_offered_prob`
   - INSERT `speed_positions`, INSERT `speed_trades`, UPDATE `users.balance_usd`, INSERT `transactions`
4. Returns `{ position_id, trade_id, payout_if_won, ... }`

### Resolution

1. `pg_cron` fires `speed_resolve_expired_markets()` every minute
2. For each `closes_at < NOW()` and `status = 'open'`:
   - Acquire advisory lock on `speed_resolve_<market_id>`
   - Compute 30-sec TWAP from `speed_oracle_ticks`
   - If no ticks → void, refund all positions
   - Else: outcome = `over` if TWAP > strike, `under` if <, `at_strike` if =
   - For each open position: settle (winner / loser / push) → INSERT `transactions`, UPDATE `speed_positions.status`, INSERT `speed_settlements`
   - UPDATE `speed_markets.status = 'resolved'`

### Deposit (3pay)

1. User initiates payment via 3pay UI (external)
2. 3pay sends webhook to `/api/webhook/3pay` with signed payload
3. API route validates HMAC, idempotency on `provider_ref`
4. Calls `process_deposit(...)`:
   - INSERT `deposits` row (status `verified`)
   - UPDATE `users.balance_usd`
   - INSERT `transactions` (`type='deposit'`)
   - INSERT `notifications`

### Withdrawal

1. User taps "Withdraw" → enters amount + method
2. Frontend calls `process_withdrawal(...)`:
   - Lock `users` row, check balance
   - INSERT `withdrawals` (status `pending`)
   - DEBIT `users.balance_usd` immediately (no hold)
   - INSERT `transactions` (`type='withdrawal'`, negative amount)
3. Admin reviews `/admin/withdrawals`, marks `approved`, settles externally, updates status to `sent`
4. If rejected: refund via INSERT `transactions` (positive `admin_credit`)

---

## 6. Security model

- **Auth.js JWT → app.user_id GUC** (W6+). Every API route extracts user from session, sets `SET LOCAL app.user_id = '<uuid>'` on RDS connection. Postgres `app.user_id()` reads from session GUC.
- **`SECURITY DEFINER` functions** trust the GUC, NOT request params. User-supplied `user_id` ignored; always `app.user_id()`.
- **`SELECT FOR UPDATE`** locks user/market/amm rows in every balance-mutating RPC. Prevents double-spend.
- **Append-only `transactions`** — source of truth. `balance_usd` is derived (cached). Reconciliation cron (W10 lean ops rebuild) detects drift.
- **Idempotency keys** on `speed_trades` (idx_unique) and `deposits.provider_ref` (unique constraint) prevent duplicate writes.
- **Frozen accounts** — `users.is_frozen = true` blocks all RPCs that mutate balance.
- **Admin PIN** — `admin_config` table; bcrypt-hashed 6-digit PIN with attempt limits. Required for credit/debit operations.

---

## 7. Environments

| Env | Frontend | DB | Access |
|---|---|---|---|
| **Local** | `next dev` on `localhost:3000` | Docker Postgres on workstation | Full |
| **Staging** | `staging.sooq.exchange` (Vercel preview) | RDS small (W5+) | Full via `aws cli` |
| **Production** | `sooq.exchange` (Vercel) | RDS multi-AZ (W11+) | CI/CD only |

Region: `eu-central-1` (Frankfurt). Bahrain `me-south-1` was first choice for latency but blocked by Lebanese ISP. See `docs/AWS_RESOURCES.md` for all infrastructure IDs.

---

## 8. CI / CD

Bare-minimum until W7 expands it.

- **`ci.yml`** — runs `npm run lint` + `npx tsc --noEmit` on PRs and pushes
- W5: add Drizzle migration apply + RDS Proxy connection check
- W7: add full Drizzle migrate to staging on push to `staging`
- W11: add manual GitHub environment approval gate for `staging → main`

Pre-commit hook: `npx tsc --noEmit`.
Pre-push hook: blocks direct pushes to existing `main` (allows first-push to new branches).

---

## 9. Repo paths

```
src/
├── app/
│   ├── (app)/         # User-facing routes
│   ├── admin/         # 5 surviving admin pages
│   ├── api/           # Webhooks + auth + speed crons + wallet + health
│   └── auth/          # OAuth callback handlers
├── components/        # UI (admin, auth, feed, layout, locale, profile, providers, speed, wallet, ui, icons)
├── hooks/             # Speed mode + auth + balance + transactions
├── i18n/messages/     # en.json, ar.json
├── lib/
│   ├── db/schema.ts   # Drizzle source of truth
│   ├── auth/          # Auth helpers (W6 rewrite for Auth.js)
│   ├── supabase/      # Supabase clients (deleted in W7)
│   ├── verifyway.ts   # WhatsApp OTP integration
│   └── ...
└── tests/             # 16 surviving test files

supabase/
├── migrations/        # 366 SQL files; 364–366 are W2/W3/W4 strip + rewrites
├── config.toml        # Local Supabase config (sooq, ports 54421+)
└── seed.sql           # Empty-ish, will be rewritten in W7

docs/
├── ARCHITECTURE.md    # this file
├── SPRINT_LOG.md      # rebuild progress
├── STRIP_NOTES.md     # W3 surgery notes
├── speed-runbook.md   # ops notes for speed mode
└── ICONS.md           # icon conventions

.github/workflows/ci.yml   # bare-minimum CI

scripts/
├── hooks/             # pre-commit (tsc), pre-push (block main)
└── install-hooks.sh   # postinstall

drizzle.config.ts      # Drizzle Kit config
src/lib/db/schema.ts   # Drizzle schema
```

---

## 10. Known operational gaps (W5–W12 work)

- **Admin tooling stripped in W2** — `system_logs`, alerts dashboard, balance reconciliation, Slack alerts. Lean rebuild scheduled between W10 and W11 before launch.
- **`fee_config` table still present** — speed RPCs read 5+ rates from it. Hardcode into RPCs once fee values are confirmed (separate migration; pending).
- **`speed_pool_ledger` was the old reseller variance tracker** — gone in W3. House P&L is now derived by aggregating `transactions` rows (`speed_stake`, `speed_payout`, `speed_cashout`, `speed_refund`).
- **Migrations 001–363 are inherited cruft** — they apply but most reference dropped objects. Squash to a single `001_init.sql` is a W7 candidate when we cut over to RDS via Drizzle Kit.
- **Speed tests don't pass yet** — they reference helpers that assume Supabase test infra. W7 service migration includes test infrastructure rewrite.

---

## 11. Phase roadmap (truncated — see plan file for full)

| Phase | Goal | Status |
|---|---|---|
| W1 | Setup new repo, copy codebase, basic CI | ✓ |
| W2 | Strip LMSR + demo + prelaunch + stale features + admin tooling | ✓ |
| W3 | Strip branches + commission + speed_branches | ✓ |
| W4 | Speed RPCs retail-only + admin slim + Drizzle foundation | ✓ |
| W5 | AWS infra (RDS, S3, CloudFront, IAM) — **blocked on AWS account access** | pending |
| W6 | Auth.js + GUC pattern + WhatsApp OTP port + Google OAuth | pending |
| W7-W8 | Service migration: Drizzle replaces supabase-js, S3 storage, polling | pending |
| W9 | Speed-specific AWS validation (pg_cron, TWAP, exposure caps under load) | pending |
| W10 | E2E QA + lean ops rebuild + canary prep | pending |
| W11 | Canary cutover on `v2.sooq.exchange` | pending |
| W12 | Full cutover, freeze old prediction-market repo | pending |
