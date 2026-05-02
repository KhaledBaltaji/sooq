# Architecture Reference

**Last updated:** 2026-04-06
**System:** MENA Prediction Market Platform (Sooq)
**Migrations:** 191 (001 through 191, ~120 files with gaps)
**Tests:** 77 across 9 suites

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Data Model Summary](#2-data-model-summary)
3. [Core Trading Engine](#3-core-trading-engine)
4. [Deposits & Withdrawals](#4-deposits--withdrawals)
5. [Market Lifecycle](#5-market-lifecycle)
6. [Commission & Agent System](#6-commission--agent-system)
7. [Admin Panel](#7-admin-panel)
8. [Support System](#8-support-system)
9. [Telegram Integration](#9-telegram-integration)
10. [Realtime Subscriptions](#10-realtime-subscriptions)
11. [Price Charts](#11-price-charts)
12. [Notifications](#12-notifications)
13. [Auth & Security](#13-auth--security)
14. [System Flows](#14-system-flows)
15. [Pre-Launch System](#15-pre-launch-system)
16. [Geo Tracking](#16-geo-tracking)
17. [Incomplete Features (Backend Only)](#17-incomplete-features-backend-only)
18. [Branch/Bookmaker System (S2)](#18-branchbookmaker-system-s2)
19. [Demo Mode](#19-demo-mode)

---

## 1. System Architecture Overview

### Layers

```
Browser / Next.js App Router (src/app/)
  ↓  supabase.rpc() calls from hooks and page components
Supabase JS Client (anon key, user session via Supabase Auth)
  ↓  PostgREST /rpc/ endpoint
Postgres RPC Functions (SECURITY DEFINER, auth.uid() for identity)
  ↓  SQL DML inside explicit transactions
Postgres Tables (users, markets, amm_state, trades, positions, transactions, …)
```

There is no separate Node.js backend. All financial logic lives in Postgres stored functions called via `supabase.rpc()`. The Next.js layer provides:

- **App Router pages** — user-facing UI (`src/app/(app)/`) and admin panel (`src/app/admin/`)
- **API routes** — webhook handlers (`/api/webhook/`), cron jobs (`/api/cron/`), internal logging (`/api/internal/`)
- **Hooks** — thin wrappers around `supabase.rpc()` (e.g. `src/hooks/use-execute-trade.ts`)
- **Support** — WhatsApp deep link (`src/lib/support-whatsapp.ts` + `NEXT_PUBLIC_SUPPORT_WHATSAPP` env)

### Key Design Decisions

| Decision | Rationale |
|---|---|
| All financial logic in Postgres | Atomic transactions, no application-level race conditions |
| `auth.uid()` inside RPC | Users can never spoof their identity; only admin/webhook RPCs accept `p_user_id` |
| Append-only `transactions` ledger | `balance_usd` on `users` is a cache; truth is `SUM(transactions.amount)` |
| `SELECT FOR UPDATE` in deterministic order | Prevents deadlocks on concurrent trades by the same referral tree |
| Fee rates from `fee_config` table | Rates are never hardcoded; admins can update via PIN-protected RPC |
| Activation gate (5 qualified referrals) | Prevents commission farming; commissions are escrowed until threshold met |
| WhatsApp-only support | Single MENA-native channel; no ticket system to operate at launch |

### Fee Architecture (Subliminal Model)

Every trade collects multiple fees, all stored as separate columns on `trades`:

| Fee | Direction | Rate (default) | Description |
|---|---|---|---|
| `explicit_fee` | Buy + Sell | 0.5% | Visible fee charged on gross amount |
| `amm_spread_cost` | Buy + Sell | ~2–3% | LMSR pricing slippage |
| `cash_out_premium` | Sell only | 0.5% | Exit penalty |
| `dynamic_spread` | Buy (heavy side) | 0.5% avg | Activated when price > 65% threshold |
| `resolution_fee` | Resolution | 1% | Applied to winning shares at payout |

Platform revenue = sum of all five fee columns. Commission is paid as a percentage of `explicit_fee + amm_spread_cost + cash_out_premium` (not resolution fee — that is settled separately).

### AMM Model (LMSR)

```
Cost function: C(q_yes, q_no) = b × ln(e^(q_yes/b) + e^(q_no/b))
Price(yes)   = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
```

`b` = liquidity parameter (default 1000, read from `fee_config.amm_default_b`). Shares pay $1.00 at resolution (before the 1% fee). Users may buy YES and NO shares on the same market simultaneously. All price math lives in helper functions `lmsr_price()`, `lmsr_cost()`, and `lmsr_shares_for_cost()`.

---

## 2. Data Model Summary

### Core Tables

| Table | Purpose |
|---|---|
| `users` | Accounts, balances (cache), referral chain, agent level, wagering |
| `markets` | Market questions, status FSM, AMM liquidity param, timestamps |
| `amm_state` | Per-market LMSR state: q_yes, q_no, prices, volume, seed_pnl |
| `trades` | Every buy/sell with fee breakdown columns (incl. `dynamic_spread`), post-trade prices |
| `positions` | Per-user per-market per-side holdings (UPSERT on each trade) |
| `transactions` | Append-only ledger; every balance change creates a row |
| `deposits` | Confirmed on-chain deposit records (idempotent via `provider_ref`) |
| `withdrawals` | User withdrawal requests (pending → approved/rejected) |
| `referral_commissions` | One row per ancestor per trade; status: escrowed → credited → voided |
| `fee_config` | All fee rates keyed by `(fee_type, level, depth)` |
| `platform_revenue` | One row per resolved market with revenue breakdown |
| `admin_config` | Per-admin bcrypt PIN hash, failed attempts, lockout |
| `system_logs` | Structured error/event log with severity, source, context JSON |
| `notifications` | Bilingual in-app notifications (EN/AR) with type and reference_id |
| `price_alerts` | User-defined price threshold alerts |
| `leader_stats` | Leaderboard data: total_trades, winning_trades, accuracy_pct |
| `market_comments` | Threaded comments on markets (parent_id for nesting) |
| `comment_likes` | Like tracking per comment per user |
| `news_articles` | Market-linked news with sentiment scoring |
| `help_collections` | Help center categories |
| `help_articles` | Help center articles (slug-based, bilingual) |
| `user_wallets` | Crypto wallet addresses for deposits |
| `copy_settings` | Copy trading config (deferred feature) |

### Market Status FSM

```
draft → open → closed → resolved
              ↓               ↘ voided (auto if no winning positions)
              └──────────────→ voided (admin or dead market check)
```

### Transaction Types

`bet`, `trade`, `cash_out`, `win`, `resolution_payout`, `deposit`, `withdrawal`, `commission`, `commission_release`, `bonus`, `refund`, `seed`, `admin_credit`, `admin_debit`, `agent_transfer_out`, `agent_transfer_in`

---

## 3. Core Trading Engine

### 3.1 Buy Shares

**Entry point:** `src/app/(app)/market/[id]/page.tsx` → `useExecuteTrade` hook → `supabase.rpc('execute_trade', { p_market_id, p_side, p_amount })`

**RPC:** `execute_trade` (latest: migration 177)

**Lock order (deterministic, prevents deadlocks):**
1. `users WHERE id = auth.uid()` — `FOR UPDATE`
2. `users WHERE id = ANY(referral_chain ORDER BY id)` — `FOR UPDATE` (all ancestors in UUID ascending)
3. `markets WHERE id = p_market_id` — `FOR UPDATE`
4. `amm_state WHERE market_id = p_market_id` — `FOR UPDATE`

**Pre-condition checks:**
- User exists and is not frozen
- `p_side IN ('yes', 'no')`, `p_amount > 0`
- Market status = `'open'`, `NOW() < closes_at`
- `balance_usd >= p_amount`
- Calculated shares ≤ `amm_max_trade_pct × b` (default 5% of liquidity)

**Fee calculation:**
```
explicit_fee    = p_amount × explicit_fee_rate      (default 0.5%)
net_amount      = p_amount - explicit_fee
dynamic_spread  = net_amount × (multiplier - 1) × rate  (if current_price > 0.65)
net_amount     -= dynamic_spread
shares          = lmsr_shares_for_cost(b, q_yes, q_no, side, net_amount)
amm_spread      = net_amount - (shares × current_price)  [≥ 0]
```

**Tables written:**
1. `users` — `balance_usd -= p_amount`, `total_wagered += p_amount`
2. `amm_state` — update `q_yes`/`q_no`, prices, `total_volume`, `total_trades`
3. `positions` — UPSERT `(user_id, market_id, side)`
4. `trades` — INSERT with all fee columns + `post_trade_yes_price`/`post_trade_no_price`
5. `transactions` — INSERT (`type = 'trade'`, `amount = -p_amount`, `balance_after = new_balance`)
6. **Commission:** `PERFORM pay_trade_commissions(trade_id, user_id, p_amount)` (see §6.1)
7. `markets` — `trade_count += 1`, `unique_traders` recalculated
8. `leader_stats` — UPSERT `total_trades += 1`
9. `price_alerts` — trigger matching alerts → INSERT `notifications`

**Returns:** `{ trade_id, shares, price_per_share, total_cost, explicit_fee, new_yes_price, new_no_price, price_impact_warning }`

### 3.2 Sell Shares

**Entry point:** Same as buy. `p_shares_to_sell` = number of shares to sell.

**Additional lock:** `positions WHERE user_id AND market_id AND side` — `FOR UPDATE`

**Pre-conditions:** Position exists with `shares_held >= p_shares_to_sell`

**Fee calculation:**
```
gross_proceeds  = lmsr_cost(old_q) - lmsr_cost(new_q)
explicit_fee    = gross_proceeds × explicit_fee_rate
cash_out_premium= gross_proceeds × cash_out_rate
net_proceeds    = gross_proceeds - explicit_fee - cash_out_premium
```

**Tables written:** Same as buy, but `users.balance_usd += net_proceeds` (no wagering change — only buys count). `unique_traders` recalculated on sell path too (migration 177).

### 3.3 LMSR Price Helpers

| Function | Purpose |
|---|---|
| `lmsr_cost(b, q_yes, q_no)` | Total cost of current AMM state |
| `lmsr_price(b, q_yes, q_no, side)` | Current marginal price for YES or NO |
| `lmsr_shares_for_cost(b, q_yes, q_no, side, cost)` | Binary search: how many shares for a given cost |
| `get_amm_price(p_market_id)` | Returns current prices + volume + trades from `amm_state` |
| `get_cash_out_value(p_market_id, p_side, p_shares)` | Preview net proceeds for selling |

---

## 4. Deposits & Withdrawals

### 4.1 Deposit

**Entry point:** 3pay webhook → `POST /api/webhook/3pay` → `supabase.rpc('process_deposit', { p_user_id, p_amount, p_currency, p_provider_ref, p_provider })`

**RPC:** `process_deposit` (migration 106)

**Idempotency:** Checks `deposits WHERE provider_ref = p_provider_ref` before any writes.

**Lock:** `users WHERE id = p_user_id` — `FOR UPDATE`

**Tables written:**
1. `deposits` — INSERT with `status = 'confirmed'`
2. `users` — `balance_usd += net_amount`
3. `transactions` — INSERT (`type = 'deposit'`)

**Side effects:** Webhook failure → Slack alert via `sendSlackAlert()`

### 4.2 Withdrawal

**Entry point:** `src/app/(app)/wallet/withdraw/page.tsx` → `supabase.rpc('process_withdrawal', { p_amount, p_destination, p_currency })`

**RPC:** `process_withdrawal` (migration 024). Auth: `auth.uid()`

**Lock:** `users WHERE id = auth.uid()` — `FOR UPDATE`

**Validation checks:**
1. `p_amount >= 10` (minimum)
2. User not frozen
3. `total_wagered >= wagering_requirement`
4. 24-hour hold after first deposit
5. `balance_usd >= p_amount`

**Tables written:**
1. `users` — `balance_usd -= p_amount`
2. `withdrawals` — INSERT `status = 'pending'`
3. `transactions` — INSERT (`type = 'withdrawal'`)

**Admin approval:** Withdrawal stays `pending` until admin approves/rejects from `/admin/withdrawals`. Approval triggers payout. Rejection refunds `balance_usd`.

### 4.3 Deposit Bonus

**RPC:** `claim_deposit_bonus` (migration 028). Auth: `auth.uid()`

**Eligibility:** `deposit_bonus_claimed = FALSE`, `referred_by IS NULL` (organic only), has confirmed deposit ≥ $20.

**Effect:** `balance_usd += 5.00`, `wagering_requirement += 10.00`, `deposit_bonus_claimed = TRUE`

---

## 5. Market Lifecycle

### 5.1 Create Market

**RPC:** `admin_create_market` (migration 154). Atomic: market INSERT + AMM init in single transaction.

**Tables written:** `markets`, `amm_state`, `system_logs`

### 5.2 Lock Market

**RPC:** `lock_market` (migration 154). Sets `status = 'closed'`. Blocks new trades.

### 5.3 Resolve Market

**RPC:** `resolve_market` (migration 176, fixed in 179+180)

**Security:** PIN-protected. Requires `p_pin TEXT` parameter. Verifies against `admin_config.pin_hash` using `crypt()` (pgcrypto). 5-attempt lockout, 15-minute freeze. Function is `SECURITY DEFINER` with `SET search_path = public, extensions`.

**Lock order:**
1. `markets` — `FOR UPDATE`
2. `amm_state` — `FOR UPDATE`
3. Per winning position: `users` — `FOR UPDATE` (ordered by user_id)

**Auto-void:** If no winning positions exist, delegates to `_void_market_internal`.

**Steps:**
1. Verify admin auth + PIN
2. Set `app.trigger_bypass` for protected column updates
3. Read `resolution_fee_rate` from `fee_config`
4. For each winner: `payout = shares_held × (1 - resolution_fee_rate)`, credit balance
5. Set `status = 'resolved'`, `outcome`, `resolved_at`
6. Call `settle_resolution_commissions(p_market_id)`
7. Call `record_revenue(p_market_id)` → INSERT `platform_revenue`
8. Update `leader_stats` for winners
9. **Notify all position holders:** INSERT `notifications` for winners (`resolution_win`) and losers (`resolution_loss`) with bilingual text (EN/AR)
10. INSERT `system_logs` audit entry

### 5.4 Void Market

**RPC:** `_void_market_internal` (migration 157)

**Lock order:**
1. `markets` — `FOR UPDATE`
2. `referral_commissions` — bulk `FOR UPDATE` (race prevention)
3. Per credited commission: `users` — `FOR UPDATE` (clawback)
4. Per position: `users` — `FOR UPDATE` (refund, ordered by user_id)

**Steps:**
1. Lock + claw back credited commissions (debit `agent_balance_usd`)
2. Void all commission records (escrowed + credited)
3. Refund all positions: `shares_held × avg_entry_price`
4. Set `status = 'voided'`

---

## 6. Commission & Agent System

### 6.1 Trade Commission (pay_trade_commissions)

**Trigger:** Called from `execute_trade` after trade INSERT.

**RPC:** `pay_trade_commissions(p_trade_id, p_user_id, p_trade_amount)` (migration 150)

**Steps:**
1. Calculate `platform_revenue = explicit_fee + amm_spread_cost + cash_out_premium`
2. **First-trade detection:** Increment referrer's `qualified_referral_count`. Auto-activate at 5.
3. Walk `referral_chain` (max 3 layers):
   - Update ancestor's `network_volume += p_trade_amount`
   - Inline tier advancement (ratchet): $10K → L2, $50K → L3, $200K → L4
   - Call `_credit_commission()` — escrow or credit based on activation status

### 6.2 Resolution Commission (settle_resolution_commissions)

**RPC:** `settle_resolution_commissions(p_market_id)` (migration 131)

Called from `resolve_market`. For each winning position's referral chain, credits commission on `resolution_revenue = shares_held × resolution_fee_rate`.

### 6.3 Agent Activation Gate

- Agents start with `agent_activated = FALSE`
- Commissions stored as `escrowed` until activation
- Activation fires at 5 qualified referrals (referrals who placed ≥1 trade)
- `_release_escrowed_commissions()` bulk-credits all escrowed rows
- Admin can override via `toggle_agent_activation_override()`

### 6.4 Agent Wallet

Commissions credit `agent_balance_usd` (separate from trading `balance_usd`). Agent can transfer to portfolio via `transfer_agent_to_portfolio` RPC. This separation prevents agents from accidentally trading with commission earnings.

### 6.5 Tier System

```
Level 1: network_volume <  $10,000  → Direct 20%, Indirect 5%, Deep 2%
Level 2: network_volume >= $10,000  → Direct 30%, Indirect 8%, Deep 3%
Level 3: network_volume >= $50,000  → Direct 35%, Indirect 10%, Deep 5%
Level 4: network_volume >= $200,000 → Direct 45%, Indirect 15%, Deep 7%
```

Levels ratchet up only — never decrease. Canonical spec: `docs/commission-model.md`.

---

## 7. Admin Panel

### 7.1 PIN System

All destructive admin operations require a 6-digit PIN:

- **Storage:** bcrypt hash in `admin_config.pin_hash`
- **Setup:** `admin_set_pin` RPC (migration 152)
- **Verification:** `crypt(p_pin, pin_hash)` comparison in each protected RPC
- **Lockout:** 5 failed attempts → `pin_locked_until = NOW() + 15 minutes`
- **Reset:** Successful PIN verification resets `failed_pin_attempts` to 0
- **Protected RPCs:** `admin_adjust_balance`, `admin_update_fee`, `resolve_market`

### 7.2 Credit / Debit User (admin_adjust_balance)

**RPC:** `admin_adjust_balance` (migration 152). PIN-protected.

**Lock order:** `admin_config` → `users`

**Limits:** `ABS(p_amount) <= 10000`, frozen users can't be debited.

### 7.3 Update Fee (admin_update_fee)

**RPC:** `admin_update_fee` (migration 154). PIN-protected.

**Effect:** Updates `fee_config.rate`. All subsequent RPCs use the new rate immediately.

### 7.4 Stats Dashboard

**RPCs (migration 178):**
- `get_stats_users` — signups, active users, retention metrics
- `get_stats_trading` — volume, trades, unique traders by period
- `get_stats_markets` — market creation, resolution, status breakdown
- `get_stats_finance` — deposits, withdrawals, net flow by period
- `get_stats_revenue` — revenue breakdown by fee type
- `get_stats_health` — system health: error rates, system metrics

**Frontend:** `/admin/stats` with modular components (`module-finance.tsx`, `module-health.tsx`, `module-markets.tsx`, `module-revenue.tsx`, `module-trading.tsx`, `module-users.tsx`)

### 7.5 Admin Support

**Pages:** `/admin/support` (ticket list), `/admin/support/[ticketId]` (ticket detail + reply)

Admin can view all support tickets, reply (disables AI), and close tickets. Replies to Telegram-channel tickets are forwarded via bot.

### 7.6 Admin Help CMS

**Pages:** `/admin/help`, `/admin/help/collections/*`, `/admin/help/articles/*`

Full CRUD for help center content. Collections (categories) and articles with markdown editor. See `docs/admin-panel.md` §4.16–4.21.

---

## 8. Support (WhatsApp deep link)

The full ticket system, AI chat agent, and Telegram bot were removed in migration 301 to reduce operational surface ahead of launch. Users now contact support via a single WhatsApp deep link rendered across the app (account drawer, profile dropdown, profile page, help pages).

**Configuration:** `NEXT_PUBLIC_SUPPORT_WHATSAPP` env var (international number, digits-only after sanitisation). When unset, the contact buttons are hidden — the rest of the app stays functional.

**Helper:** `src/lib/support-whatsapp.ts` exports `getSupportWhatsAppHref(message)` and `isSupportWhatsAppConfigured()`. Server and client components both use it directly with an `<a href={...} target="_blank">` tag.

**Pre-filled message:** localised via `support.whatsAppDefaultMessage` (en/ar). Users land on a wa.me chat with the message ready to send.

**No DB tables, no realtime, no cron, no API routes.** A future ticketing rebuild is out of scope of this strip.

**What stayed:** Help Center (`help_collections`, `help_articles`) is unchanged — read-only knowledge base served at `/help` with admin CRUD at `/admin/help`.

---

## 9. (reserved)

Section 9 — Telegram Integration — was removed in migration 301 with the rest of the support stack. This anchor is kept so deep links into the doc don't 404; numbering for §10+ unchanged.

---

## 10. Realtime Subscriptions

### 10.1 Published Tables

Tables added to `supabase_realtime` publication:

| Table | Added in | Purpose |
|---|---|---|
| `markets` | migration 050 | Live market status changes |
| `amm_state` | migration 050 | Live price updates |
| `trades` | migration 100 | Trade feed |
| `positions` | migration 105 | Position updates |
| `notifications` | migration 105 | In-app notification delivery |
| `deposits` | migration 106 | Deposit confirmation |

### 10.2 Client Subscription Patterns

| Hook/Component | Subscribes to | Filter |
|---|---|---|
| `use-positions.ts` | `positions` (INSERT/UPDATE), `amm_state` (UPDATE) | `user_id=eq.{id}` on positions |
| `use-market.ts` | `amm_state` (UPDATE) | `market_id=eq.{id}` |
| `activity-feed.tsx` | `trades` (INSERT) | None (all trades) |
| `notification-dropdown` | `notifications` (INSERT) | `user_id=eq.{id}` |
| Deposit page | `deposits` (INSERT) | `user_id=eq.{id}` |

### 10.3 Health Monitoring

`src/components/ui/realtime-status.tsx` — monitors Supabase Realtime connection. Shows fixed banner "Prices may be stale — reconnecting..." on `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED` status.

---

## 11. Price Charts

### 11.1 get_price_history RPC

**RPC:** `get_price_history(p_market_id, p_period DEFAULT '1D', p_created_at DEFAULT NULL)` (migration 158, fixes in 162-164)

**Periods and bucket sizes:**

| Period | Bucket | Source |
|---|---|---|
| `1H` | 30 seconds | Last 1 hour of trades |
| `12H` | 5 minutes | Last 12 hours |
| `1D` | 15 minutes | Last 24 hours |
| `1W` | 1 hour | Last 7 days |
| `1M` | 6 hours | Last 30 days |
| `ALL` | Dynamic (based on market age) | Since market creation |

**Data source:** `trades` table with `post_trade_yes_price` / `post_trade_no_price` columns (added in migration 163). Uses `LATERAL` join to get last known price per bucket.

**Fallback:** When no trades exist in a bucket, uses previous bucket's price. If no trades at all, uses current `amm_state` prices.

### 11.2 Frontend

`src/components/market/price-chart.tsx` — Recharts area chart with Realtime append. New trades update chart live. **Capped at 500 data points** to prevent unbounded growth.

---

## 12. Notifications

### 12.1 Types

| Type | Trigger | Content |
|---|---|---|
| `price_alert` | `execute_trade` — when a trade crosses a user's alert threshold | "Price alert: {market} crossed {price}" |
| `resolution_win` | `resolve_market` — for users with winning positions | "You won! Market resolved {outcome}. You won ${payout}." |
| `resolution_loss` | `resolve_market` — for users with losing positions | "Market resolved {outcome}. Your {side} position expired." |

### 12.2 Schema

All notifications include bilingual text: `title_en`, `title_ar`, `body_en`, `body_ar`. Linked to source via `reference_id` (market UUID). Delivered via Realtime subscription on `notifications` table.

### 12.3 Frontend

`src/app/(app)/notifications/page.tsx` — list view with read/unread state. Notification dropdown in nav bar for quick access.

---

## 13. Auth & Security

### 13.1 Login Flow

Supabase Auth with multiple providers:
- **Email + Password** — primary for testing and direct signups
- **Phone OTP** — planned for production
- **Google OAuth** — social login option

Session managed via `@supabase/ssr` middleware: `updateSession()` refreshes tokens on every request.

### 13.2 Middleware

`src/middleware.ts` — runs on all routes except static assets.

**Rate limiting:** Per-IP sliding window via `src/lib/rate-limit.ts`. In-memory store.

| Route pattern | Limit | Window |
|---|---|---|
| `/api/webhook/*` | 60 | 1 min |
| `/api/*` | 100 | 1 min |
| Default | None | — |

429 responses include `Retry-After: 60` header. Rate limit events logged to `system_logs`.

### 13.3 RPC Security

| Rule | Implementation |
|---|---|
| User identity | `auth.uid()` inside every user-facing RPC — never trust client params |
| Admin identity | `auth.uid()` + `is_admin = TRUE` check |
| Protected columns | `trg_protect_sensitive_user_columns` trigger on `users` table |
| Trigger bypass | `PERFORM set_config('app.trigger_bypass', 'true', true)` in SECURITY DEFINER RPCs |
| Search path | `SET search_path = public, extensions` on SECURITY DEFINER functions (includes pgcrypto) |

### 13.4 RLS Policies

Row Level Security enabled on all tables. Key patterns:
- Users can read/write their own rows
- Admin users can read all rows
- Service role (webhooks, cron) bypasses RLS
- `positions`, `trades` are publicly readable (market transparency)

---

## 14. System Flows

### 14.1 Balance Reconciliation

**RPCs:** `reconcile_balances()`, `reconcile_agent_balances()` (migrations 031, 150)

Compare `balance_usd` cache against `SUM(transactions.amount)`. Report discrepancies > $0.001. Called by `/api/cron/check-errors` → Slack alert on mismatch.

### 14.2 Agent Level Update

**RPC:** `update_agent_level(p_user_id)` (migration 133)

Standalone tier advancement by network volume. Used by `handle_referral_signup` trigger. Ratchet only (levels never decrease).

### 14.3 Error Logging Pattern

All critical RPCs wrap their body in `EXCEPTION WHEN OTHERS THEN` that calls `log_system_event()` before re-raising:

```sql
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_event(
    'error'::log_severity, 'pg/execute_trade', SQLERRM,
    jsonb_build_object('user_id', v_user_id, 'market_id', p_market_id, 'sqlstate', SQLSTATE)
  );
  RAISE;
```

Admin panel at `/admin/logs` filters by severity and source.

### 14.4 Cron Jobs

| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/check-errors` | Every 10 min | Poll system_logs for unacknowledged errors, balance mismatches → Slack |
| `/api/cron/fetch-news` | Periodic | Fetch market-related news articles |
| `/api/cron/rank-markets` | Periodic | Update `homepage_rank` on markets for homepage ordering |

### 14.5 Monitoring

| System | Purpose |
|---|---|
| **Sentry** | Error tracking + performance monitoring. 10% trace sampling in production (reduced from 100% during dev). |
| **Slack** | `sendSlackAlert()` for payment failures, trade errors, cron alerts |
| **Health endpoint** | `GET /api/health` — checks DB connectivity, returns 503 on degradation |
| **Admin alerts** | `/admin/alerts` — dashboard showing system health overview |

---

## 15. Pre-Launch System

### 15.1 Overview

A standalone pre-launch experience at `/(prelaunch)/shu-rayak/` for collecting interest before go-live. Not gated by auth — fully public.

### 15.2 Tables

- `prelaunch_questions` — bilingual prediction questions with yes/no counters
- `prelaunch_votes` — anonymous votes tied to visitor_id (deduplicated)
- `prelaunch_waitlist` — phone-based waitlist with referral tracking

### 15.3 RPCs

- `record_prelaunch_vote(question_id, vote, visitor_id)` — atomic vote + counter increment
- `increment_referral_count(referral_code)` — waitlist referral tracking

### 15.4 API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/prelaunch/waitlist` | POST | Join waitlist with phone + optional referral |
| `/api/prelaunch/questions` | GET | Fetch active questions |
| `/api/prelaunch/vote` | POST | Submit a vote |
| `/api/prelaunch/stats` | GET | Waitlist + vote stats |

### 15.5 Environment

`COMING_SOON` env var — when set, middleware redirects all app routes to the coming-soon page. The pre-launch routes are excluded from this redirect.

---

## 16. Incomplete Features (Backend Only)

These features have database tables and/or RPCs but no user-facing UI:

| Feature | Backend Status | Frontend Status | Notes |
|---|---|---|---|
| **Leaderboard** | `leader_stats` table, updated by `execute_trade` + `resolve_market` | `/components/leaderboard/` directory is empty | Backend complete, needs UI |
| **Market Comments** | `market_comments` + `comment_likes` tables, realtime enabled | No UI component | Tables ready, needs comment thread UI |
| **Price Alerts (creation)** | `price_alerts` table, triggers fire in `execute_trade` | No UI to create/manage alerts | Notifications work when triggered, but users can't set alerts |
| **Copy Trading** | `copy_settings` + `leader_stats` tables created | No UI, no `execute_copy_trade` RPC | Tables only, deferred to post-launch |

---

## Appendix: Migration History

| Range | Theme |
|---|---|
| 001–035 | V1 schema: users, markets, trades, positions, transactions, deposits, withdrawals |
| 040–063 | V2 pool-based model (superseded by V3) |
| 100–122 | V3 LMSR AMM: amm_state, execute_trade, resolve_market, price alerts, copy settings |
| 129–135 | NGR commission model: multi-level, network volume tiers |
| 136–142 | Admin panel: credit/debit, fee editor, market ops |
| 143–150 | Agent wallet, activation gate, escrowed commissions |
| 151–157 | Admin PIN, atomic market creation, void clawback, leader stats |
| 158–164 | Price charts, trade-based history, post-trade prices, rate limit removal |
| 165–167 | Fee config fixes, trigger bypass, price alerts column |
| 168 | Support tables (tickets, messages, verification codes) |
| 169–174 | Terminology standardization, closes_at check, balance_after fix + backfill |
| 175 | AI support (Anthropic) + Telegram integration |
| 176 | Resolution notifications + PIN requirement |
| 177 | Sell path: unique_traders + price_impact_warning |
| 178 | Comprehensive admin stats dashboard RPCs |
| 179–180 | Fix resolve_market: column name + pgcrypto search_path |
| 182 | Fix system_logs INSERT policy (service_role only) |
| 183 | update_homepage_ranks function (atomic reranking) |
| 184 | Reduce activation threshold from 10 to 5 |
| 185 | Pre-launch: waitlist, questions, voting system |
| 186 | News full-text search + search_news_for_market RPC |
| 187 | V1 stabilize: dynamic_spread column, UPDATE...RETURNING for balance concurrency |
| 188 | Realtime: add deposits, market_comments, support_tickets, referral_commissions, users |
| 189 | Zero-dust positions cleanup (< 0.001 shares) |
| 190 | Fix process_deposit/withdrawal RETURNING clause |
| 191 | Performance indexes on referral_commissions, market_comments |
| 192–201 | Various retail improvements and fixes |
| 202 | `branches` table — metadata, status enum, markup config, pool_balance cache |
| 203 | `branch_pools` append-only ledger — branch pool inflows/outflows |
| 204 | `branch_agents` — agent/sub-agent hierarchy with commission rates |
| 205 | `branch_user_assignments` — user-to-branch-to-agent mapping |
| 206 | `branch_trades` audit table — per-trade branch accounting |
| 207a/b/c | `branch_market_config`, `branch_position_caps`, `credit_chain_ledger`, `branch_admin_overrides`. ALTER trades/positions with branch_id. Retail isolation columns on amm_state. |
| 208 | `retail_trades` and `retail_positions` views (WHERE branch_id IS NULL) |
| 209 | Branch indexes + Realtime publication |
| 210 | `branch_solvency_check()` — utilization calculation + solvency gate |
| 211 | `execute_branch_trade()` — buy path with markup, solvency, position caps |
| 212 | `execute_branch_trade()` sell extension — cash-out with exit fee |
| 213 | Price impact cap on retail + branch trades. `reconcile_branch_solvency()` cron. |
| 214 | `branch_credit_transfer()` — hierarchical credit chain |
| 215 | `branch_withdrawal()` — manager withdrawals with reserve lock |
| 216 | Payback mode lifecycle: `activate_payback_mode`, `check_payback_escalation`, `clear_payback_mode` |
| 217 | Admin branch operations: create, status change, solvency override, pool adjustment |
| 218 | Phase 3.5 stabilization: 7 fixes (credit payback block, branch_trades columns, retail_net_cash, frozen_at, trigger cleanup, RLS) |
| 219 | `branch_settle_resolution()`, `record_branch_revenue()`, `branch_revenue` table, fixed `reconcile_branch_solvency()` |
| 220 | Branch-aware `resolve_market`, `record_revenue` (retail_trades view), `settle_resolution_commissions` (retail only) |
| 221 | Branch-aware `_void_market_internal` — retail + branch refunds with payback on deficit |
| 222 | `branch_dashboard_stats()` RPC — aggregated branch stats in one round-trip |
| 223 | `admin_list_branches()` SECURITY DEFINER function — per-branch computed stats for admin list (replaces VIEW for RLS safety) |
| 224 | Drop insecure `admin_branch_overview` VIEW (applied on staging before 223 was rewritten) |
| 225 | Create `admin_list_branches()` function on staging (idempotent CREATE OR REPLACE) |

---

## 17. Branch System

### Overview
SOOQ supports three branch archetypes, discriminated by `branches.book_type`:

| Type | Capital | Pricing | Users | Revenue |
|---|---|---|---|---|
| `reseller` | Pool-backed | Flat markup per side | Venue-locked (venue_type='reseller_branch') | Markup + branch fee |
| `bookmaker` | Parked (mig 291) | — | — | — |
| `commission` | No pool | Retail prices | Stay retail (venue_type='retail') | L1–L4 referral commissions via existing chain |

Retail and branch trades share one canonical LMSR AMM (`q_yes`/`q_no`). Reseller branches write to separate pools and ledgers; commission branches do not touch pools at all.

- **Retail trades:** `branch_id IS NULL` on `trades` and `positions`
- **Reseller branch trades:** `branch_id` set, routed through `execute_branch_trade` RPC
- **Commission branch trades:** user trades retail (`branch_id IS NULL`); commission flows via `referral_chain` just like retail agents. Branch attribution preserved via `users.signup_branch_id` for dashboard queries.
- **Data isolation:** `retail_trades` and `retail_positions` views filter `WHERE branch_id IS NULL`

### Tables

| Table | Purpose |
|-------|---------|
| `branches` | Branch metadata, status (`active`/`payback`/`frozen`/`suspended`), pool_balance cache, worst_case_total, pending_payouts, markup config |
| `branch_pools` | Append-only ledger of all branch pool movements (trade inflows, payouts, withdrawals, fees) |
| `branch_agents` | Agent hierarchy — agent_type (`pl`/`commission`), rates, parent_agent_id for sub-agents, approval status |
| `branch_user_assignments` | Maps users to branches (and optionally to agents). UNIQUE(user_id, branch_id) |
| `branch_trades` | Audit table — one row per branch trade with markup, exit_fee, side, direction, canonical prices |
| `branch_market_config` | Per-branch market toggles (is_enabled, cash_out_enabled) |
| `branch_position_caps` | Per-branch per-market position limits |
| `credit_chain_ledger` | Audit trail for all credit chain transfers |
| `branch_admin_overrides` | Audit trail for admin branch operations |

### Core RPCs

| RPC | Purpose |
|-----|---------|
| `execute_branch_trade` | Buy/sell through branch with markup extraction, solvency gate, position caps |
| `branch_solvency_check` | Computes utilization = (pending_payouts + worst_case_total) / pool_balance |
| `branch_credit_transfer` | Hierarchical money transfer: admin → manager → agent → sub-agent → user |
| `branch_withdrawal` | Manager withdraws from branch pool (blocked during payback, reserve-locked) |
| `activate_payback_mode` | Sets branch to payback when pool can't cover obligations |
| `check_payback_escalation` | Cron: payback → frozen (14d) → suspended (30d after frozen) |
| `clear_payback_mode` | Auto-clears payback when pending_payouts reaches 0 |
| `reconcile_branch_solvency` | Cron: recomputes worst_case_total, flags discrepancies |
| `admin_create_branch` | Admin creates branch (PIN required) |
| `admin_update_branch_status` | Admin changes branch status (PIN required) |
| `admin_override_solvency` | Admin temporarily loosens solvency threshold (PIN, max 7 days) |
| `admin_adjust_branch_pool` | Admin credits/debits branch pool with payback sweep (PIN required) |
| `branch_settle_resolution` | Per-branch settlement: pay winners from pool, deficit → payback |
| `record_branch_revenue` | Per-branch per-market fee accounting (markup, exit, resolution fees) |
| `branch_dashboard_stats` | Aggregated branch stats: user count, trades, volume, revenue, active agents |
| `admin_list_branches` | Admin-only branch list with computed stats (SECURITY DEFINER, replaces VIEW) |
| `apply_branch_agent` | User applies to become branch agent (status=pending) |
| `approve_branch_agent` | Branch manager approves with deal terms (type, rate, deposit) |
| `reject_branch_agent` | Branch manager rejects with optional reason |
| `update_branch_agent_deal` | Update deal terms for approved agent |

### Key Flows

**Branch Buy:** User sends $20 → 5% markup extracted ($1) → net $19 hits LMSR → pool credited $19 → shares issued → worst_case_total updated → solvency checked

**Branch Sell:** User sells shares → LMSR computes gross proceeds → exit fee deducted → pool debits net proceeds → user credited

**Payback Mode:** If branch pool can't cover obligations at resolution → pending_payouts set → status='payback' → all trade inflows sweep against pending_payouts → auto-clears when pending_payouts=0 → escalates to frozen after 14 days → suspended after 30 days frozen

**Credit Chain:** admin → manager → agent → user (strict downward hierarchy, blocked during payback/frozen/suspended)

### Branch Agent Approval Workflow

Users apply to become branch agents via the agent corner page. The flow:

1. **Apply:** User calls `apply_branch_agent(branch_id)` → creates `branch_agents` row with `status='pending'`, no type/rate set yet
2. **Review:** Branch manager sees pending applications in their dashboard
3. **Approve:** Manager calls `approve_branch_agent(agent_id, type, rate, deposit)` → sets deal terms, `status='approved'`, `is_active=true`, `approved_at/approved_by` recorded. Agent can now use referral code.
4. **Reject:** Manager calls `reject_branch_agent(agent_id, reason)` → sets `status='rejected'` with optional reason
5. **Update deal:** Manager calls `update_branch_agent_deal()` to modify terms for approved agents

All four RPCs are SECURITY DEFINER. Apply checks auth.uid() directly. Approve/reject/update verify the caller is the branch manager (owner_user_id on branches table).

### Role-Based Navigation

- `useBranchManager()` hook detects if the logged-in user owns a branch (module-level cache, avoids re-fetching)
- **ProfileDropdown:** Shows "Admin Panel" for `is_admin` users, "My Branch" link for branch managers
- **BottomNav:** Replaces the Agent tab with "My Branch" for branch managers. Detects branch context from the current URL and prefixes all navigation hrefs with the branch path.

### Lock Order
`user → market → amm_state → branches` (branch lock added LAST to avoid deadlocks with retail path)

### Commission Branch Sub-System (mig 289 + 293)

A commission branch is a `branches` row with `book_type = 'commission'`. It provides branded UX on top of the existing referral commission system without holding capital or changing prices.

**Tables (reused, no new tables):**
- `branches` — row with `book_type='commission'`, all capital/pricing fields forced to zero by CHECK
- `branch_agents` — sub-agents restricted to `agent_type='commission'` and zero deposit (trigger-enforced)
- `users.signup_branch_id` (new column) — attribution pointer, FK to branches with ON DELETE RESTRICT
- `users.referred_by` / `users.referral_chain` — populated by standard signup flow; sub-agent rides layer 1, branch owner rides layer 2

**Guards:**
- `branches_commission_no_capital` CHECK — pool/markup/fee fields all zero
- `branches_commission_no_payback` CHECK — status cannot be `payback`
- `branches_commission_slug_format` CHECK — 3-20 lowercase alphanum + hyphen for commission branches only (legacy reseller slugs grandfathered)
- `_reject_reserved_branch_slug` trigger — blocks reserved slugs (`admin`, `api`, `app`, `b`, `branch`, etc.) for all branch types
- `_enforce_commission_branch_agent_rules` trigger — fires BEFORE INSERT OR UPDATE; blocks P/L type and non-zero deposits on commission branches

**Signup resolver (`src/lib/auth/actions.ts`):** typed dispatch over three surfaces:
1. `/r/[code]` → `direct_code` ResolverInput — legacy behavior unchanged
2. `/b/[slug]/` → `branch_signup` ResolverInput with no agentCode — attribute to branch manager
3. `/b/[slug]/?agent=[sub_code]` → `branch_signup` with agentCode — attribute to sub-agent

Iron rules in the resolver:
- First-touch attribution: existing `referred_by` is never rewritten
- Cross-branch rejection: `/b/alice-sports/?agent=[bob_from_beirut]` → `BRANCH_SCOPE_MISMATCH` error
- Non-fatal on failure: signup completes even if attribution bookkeeping fails; all failures logged

**Commission flow:** identical to retail. `handle_referral_signup` populates `referral_chain`, `pay_trade_commissions` walks the 2-layer chain. No new commission-split code.

**Dashboard:** `/branch/dashboard` dispatches on `book_type`. Commission branches see a subset of tabs (Dashboard / Users / Sub-Agents / Commissions), attribution stats instead of pool stats, and a share kit modal. Reseller branches see the existing full dashboard.

**Feature flag:** `NEXT_PUBLIC_COMMISSION_BRANCH_ENABLED` (separate from `NEXT_PUBLIC_BRANCH_ENABLED` for independent rollout).

**Admin create:** `admin_create_branch(..., p_book_type, p_slug)` — accepts `'reseller'` (default) or `'commission'`. `'bookmaker'` is rejected (parked). Commission branches skip the `branch_user_assignments` write (no venue lock).

---

## 18. Demo Mode

### Overview

Demo Mode is a parallel "sandbox universe" that lets authenticated users learn the platform mechanics with $10,000 of play money before depositing real funds. Demo lives entirely at `/demo/*` routes with fully isolated `demo_*` tables — live surfaces stay 100% untouched.

**Key architectural choice (pivoted during Codex review):** two layers of isolation instead of a whole-app toggle.

1. **Route-level isolation:** Only pages under `/demo/*` read from `demo_*` tables. Live pages (`/`, `/markets`, `/market/[id]`, `/m/[code]`, `/b/[branch_code]/*`) never know demo exists. Eliminates the entire class of "live page accidentally fetching demo data" failures.
2. **Data-level isolation:** `demo_*` tables (not `is_demo` flags) preserve the live ledger invariant (`SUM(transactions) = users.balance_usd`), commission tree, revenue stats, and leaderboard aggregations. Flag-based would require every aggregation query to filter — permanent breakage risk.

**Branch interaction:** `/b/[branch_code]/*` routes are never demo. Demo is explicitly retail-only.

**Free-option exploit (accepted):** Reset preserves open positions. Users can erase losses by resetting — accepted as a known limitation since demo P&L is not a leaderboard metric.

### Tables (migration 270)

| Table | Purpose |
|-------|---------|
| `demo_markets` | Mirrors current markets shape. `resolves_at` lives HERE (public countdown). `resolution_fee_rate_snapshot = 0` (demo has no resolution fee). |
| `demo_market_scheduled_outcomes` | **Admin-only answer key.** RLS blocks SELECT for all non-admin users. Holds `scheduled_outcome` + created_by. Cron reads via SECURITY DEFINER RPC. |
| `demo_amm_state` | Mirrors amm_state. Default `liquidity_param = 5000` (5× live depth). Public read (prices must be visible). |
| `demo_positions` | Mirrors positions. Own-row + admin read; writes via SECURITY DEFINER RPCs only. |
| `demo_trades` | Mirrors trades (audit trail + price history source). |
| `demo_transactions` | Append-only ledger. Separate enum `demo_transaction_type AS ENUM ('demo_bet', 'demo_win', 'demo_reset', 'demo_seed')` keeps live `transaction_type` pure. |

### users columns (migration 270)

| Column | Purpose |
|--------|---------|
| `demo_mode boolean` | User-writable preference flag. Does NOT grant balance. |
| `demo_balance_usd DECIMAL(18,6)` | Demo sandbox balance. Matches live `balance_usd` precision exactly. |
| `demo_first_enabled_at timestamptz` | **Gate source of truth.** `/demo/*` route access checks this (not `demo_mode`). Set atomically by `toggle_demo_mode` on first enable. |
| `demo_first_trade_at timestamptz` | Conversion analytics. |
| `first_real_deposit_after_demo_at timestamptz` | Conversion analytics. Set by `process_deposit` on first real deposit for users who previously enabled demo. |

All four analytics columns are protected by the `prevent_sensitive_user_updates` trigger (extended in migration 270). Users cannot bypass RPCs by direct UPDATE. `demo_mode` is intentionally writable (preference only).

### Core RPCs (migration 271)

| RPC | Purpose |
|-----|---------|
| `toggle_demo_mode(p_enabled)` | Atomic first-enable grants $10K via `WHERE demo_first_enabled_at IS NULL` guard. Later toggles just flip the preference. |
| `demo_reset_balance()` | Reset to $10K. Positions preserved (free-option exploit accepted). Inserts `demo_reset` transaction. |
| `demo_execute_trade(p_market_id, p_side, p_amount, p_shares_to_sell)` | Pure LMSR. Zero fees, zero commissions, zero revenue, zero leader_stats. Locks `user → demo_markets → demo_amm_state → demo_positions` in deterministic order. Re-uses `lmsr_cost`, `lmsr_price`, `lmsr_shares_for_cost` (IMMUTABLE pure functions, safe to share). |
| `initialize_demo_amm(p_market_id, p_liquidity_param)` | Mirrors `initialize_amm` for `demo_amm_state`. Default b = 5000. |
| `admin_create_demo_market(...)` | Atomic: demo_markets + scheduled outcome + amm_state + synthetic initial-price trade. Admin-only. |
| `admin_resolve_demo_market(p_market_id)` | Reads `scheduled_outcome` from admin-only table, credits winners at $1/share (no resolution fee). Idempotent on re-call. |
| `demo_get_price_history(p_market_id, p_period, p_created_at)` | Mirrors `get_price_history` for `demo_trades`. |
| `get_demo_conversion_stats()` | Admin-only funnel: total enabled, total traded, total deposited after demo, median hours to graduate, 7/30-day cohort rates. |
| `admin_list_demo_markets_with_outcomes()` | Admin-only join of demo_markets + scheduled_outcomes (RLS blocks direct SELECT for admins too via the admin-only table policy). |
| `demo_seed_initial_price(p_market_id)` | Inserts a synthetic trade at 0.50 so charts never render blank. |
| `process_deposit(...)` (edited) | Now folds `first_real_deposit_after_demo_at = COALESCE(existing, CASE WHEN demo_first_enabled_at IS NOT NULL THEN NOW() ELSE NULL END)` into its single UPDATE. Zero behavioral change for non-demo users. |

### Admin RBAC

Sub-admins need `'demo'` in `admin_allowed_views`. The shared `_demo_assert_admin()` helper enforces:
- Service-role (auth.uid() IS NULL) → allowed (cron)
- Super admin (admin_allowed_views NULL or empty) → allowed
- Sub-admin with `'demo'` in scope → allowed
- Everyone else → rejected

### Cron

- **Endpoint:** `/api/cron/resolve-demo-markets` (src/app/api/cron/resolve-demo-markets/route.ts)
- **Schedule:** `0 * * * *` (hourly) — demo resolution is not time-sensitive to the minute
- **Auth:** `Authorization: Bearer ${CRON_SECRET}` → 401 otherwise
- **Runtime:** `export const maxDuration = 300` (5 min ceiling)
- **Query:** `SELECT id FROM demo_markets WHERE status = 'open' AND resolves_at <= now() LIMIT 100` (batch cap)
- **Processing:** `Promise.allSettled` → one failing market doesn't abort the batch
- **Output:** `{ resolved_count, failed_count, markets: [...] }`

### Realtime

Migration 263 adds to `supabase_realtime` publication:
- `demo_markets` (status changes via admin resolution)
- `demo_amm_state` (price movement)
- `demo_positions` (user's own positions)

Demo hooks subscribe with the same disconnect/reconnect logic as live hooks.

### Frontend (new route group)

```
src/app/(app)/demo/
├── layout.tsx              # DEMO banner + balance chip + demo bottom nav + init splash
├── page.tsx                # redirects to /demo/markets
├── markets/page.tsx        # demo market list (useDemoMarkets)
├── market/[id]/page.tsx    # detail: YES/NO cards + chart + trade panel
├── market/[id]/layout.tsx  # DEMO-prefixed metadata, robots noindex
├── positions/page.tsx      # portfolio summary + positions table
└── settings/page.tsx       # reset balance + exit-to-live
```

**Bottom-nav dedup:** The parent `(app)/layout.tsx` renders `<BottomNavGate />` (a tiny client component) instead of `<BottomNav />` directly. `BottomNavGate` checks `usePathname().startsWith("/demo")` and suppresses the global nav on demo routes so the demo layout's own demo-scoped nav is the only one visible.

### New components

`src/components/demo/`:
- `DemoBalanceChip` — $10K balance with persistent DEMO badge
- `DemoBanner` — "You're in Demo Mode" + passive "Ready to trade for real? Deposit now" CTA
- `DemoMarketCard` — amber ring + top-right DEMO chip
- `DemoTradePanel` — DEMO label in header, wired to `useDemoExecuteTrade`
- `DemoPositionsTable` — amber-tinted rows with live P&L from demo AMM
- `DemoResetButton` — confirmation modal with free-option-exploit warning
- `DemoPriceChart` — wraps recharts for demo price series

Live components (`market-card`, `trade-panel`, `balance-chip`, `price-chart`) are **not modified**.

### Entry points

1. **Desktop settings card:** `(app)/settings/page.tsx` → DemoModeCard in AccountTab → button links to `/demo`
2. **Mobile account sheet:** Demo/Live toggle row (planned — lives in `account-sheet.tsx` which is outside this worktree; follow-up commit)
3. **Admin market create:** `/admin/markets/create` → "Create as demo market" checkbox unlocks scheduled_outcome + resolves_at fields
4. **Admin stats overview:** "Demo → Real Conversion" KPI cluster (6 tiles) calling `get_demo_conversion_stats`

### Seed catalog (migration 272)

20 bilingual demo markets covering sports (5), politics (5), weather/fun (5), economy (5). Staggered resolution: 3 tomorrow, 9 next week, 4 +14 days, 4 next month. Idempotent via `ON CONFLICT DO NOTHING` on a unique `question_en` index.

### Commission & Referral Isolation (invariants)

These invariants MUST hold:
- Referral tree (`referred_by`, `referral_chain`, `agent_level`) never touched by demo RPCs.
- `demo_execute_trade` does NOT call `pay_trade_commissions` or `record_revenue`.
- `admin_resolve_demo_market` does NOT call `settle_resolution_commissions` or `branch_settle_resolution`.
- Demo activity writes **zero rows** to `commissions`, `platform_revenue`, `leader_stats`, `price_alerts`, branch pool tables.
- When a demo-enabled user makes their first real trade, commission behavior is identical to a user who never touched demo.

Test `demo-trading.test.ts` explicitly asserts zero-row writes via `assertZeroLiveWrites` helper.

### Lock Order (demo)

`users → demo_markets → demo_amm_state → demo_positions`. No cross-locking with live path — demo trades never touch `users.balance_usd` or live tables.
