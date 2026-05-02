# Admin Panel Reference

**Last updated:** 2026-04-06
**Project:** Sooq Prediction Market
**Stack:** Next.js 14 App Router, Supabase (Postgres + RPC), TypeScript

---

## Table of Contents

1. [Authentication & Access Control](#1-authentication--access-control)
2. [PIN System](#2-pin-system)
3. [Layout & Navigation](#3-layout--navigation)
4. [Admin Pages](#4-admin-pages)
5. [Shared Admin Components](#5-shared-admin-components)
6. [Supabase RPCs Referenced](#6-supabase-rpcs-referenced)
7. [Middleware & Rate Limiting](#7-middleware--rate-limiting)

---

## 1. Authentication & Access Control

**Guard file:** `/src/lib/auth/guards.ts`

All admin routes pass through the `requireAdmin()` server-side guard, which is called at the top of the shared layout (`/src/app/admin/layout.tsx`). Every page under `/admin/*` is protected by this single layout-level call.

### `requireAdmin()` logic

```
1. Call supabase.auth.getUser() with the server client (reads the session cookie)
2. If no user session → redirect("/login")
3. Query users table: SELECT is_admin WHERE id = user.id
4. If is_admin is false or null → redirect("/")
5. Return the authenticated user object
```

The `is_admin` boolean column on the `users` table is the sole authorization signal. There is no role enum or separate admin table.

---

## 2. PIN System

The PIN system gates two categories of sensitive admin operations: **balance adjustments** (credit/debit) and **fee configuration changes**.

### PIN Setup (`AdminPinSetup` component)

**File:** `/src/components/admin/admin-pin-setup.tsx`

- Renders a 6-digit PIN entry UI with individual digit inputs (auto-advance, paste support, backspace navigation).
- Two-step flow: `enter` → `confirm`. After entering the first PIN, the user is automatically advanced to a confirmation step.
- On submit, calls `supabase.rpc("admin_set_pin", { p_pin: pin })`.
- **Security notice shown in UI:** "After 5 failed attempts, your PIN will be locked for 15 minutes."
- The setup dialog appears automatically whenever a PIN-protected operation is triggered and `admin_has_pin` returns false.

### PIN Verification Flow (per operation)

1. `supabase.rpc("admin_has_pin")` is called to check whether a PIN exists.
2. If no PIN exists: `AdminPinSetup` dialog opens first to force PIN creation before proceeding.
3. If PIN exists: the operation dialog shows a 6-digit inline PIN input.
4. The PIN is passed directly to the RPC call for that operation (e.g., `admin_update_fee`, `admin_adjust_balance`). The server-side RPC validates the PIN, enforces the attempt counter/lockout, and executes the operation.

### Lockout Policy

Enforced server-side by the Supabase RPC functions. 5 failed attempts triggers a 15-minute lockout.

---

## 3. Layout & Navigation

**Layout file:** `/src/app/admin/layout.tsx`

- Calls `requireAdmin()` before rendering.
- Renders `<AdminSidebar />` and a sticky header bar with notification/settings icon buttons (currently non-functional placeholders).
- Background color: `#f7f9fb`. Main content area offset: `md:ml-64`.

### Sidebar (`AdminSidebar`)

**File:** `/src/components/admin/admin-sidebar.tsx`

Fixed dark sidebar (`#0b0f10`) on desktop (width `w-64`), slide-out Sheet drawer on mobile.

**Navigation items (in order):**

| Label | Route | Icon |
|---|---|---|
| Dashboard | `/admin` | `dashboard` |
| Markets | `/admin/markets` | `analytics` |
| Users | `/admin/users` | `group` |
| Fees | `/admin/fees` | `payments` |
| Finance | `/admin/finance` | `account_balance` |
| AMM Risk | `/admin/amm` | `monitoring` |
| Agents | `/admin/agents` | `smart_toy` |
| Stats | `/admin/stats` | `bar_chart` |
| Alerts | `/admin/alerts` | `notifications_active` |
| System Logs | `/admin/logs` | `bug_report` |
| Help Center | `/admin/help` | `help_center` |
| Support | `/admin/support` | `support_agent` |

---

## 4. Admin Pages

### 4.1 Dashboard — `/admin`

**File:** `/src/app/admin/page.tsx` (Server Component)

**Data Fetched:** `deposits`, `withdrawals`, `platform_revenue`, `trades`, `amm_state`, `markets`

**Key Computed Metrics:**
- Settled Revenue — sum of `net_revenue` from `platform_revenue`
- Unrealized Fees — sum of `explicit_fee + amm_spread_cost + cash_out_premium` from all `trades`
- Platform Risk Ratio — `total_liquidity_param / total_outstanding_shares`
- Vault Utilization — `(active_markets * 1000) / total_liquidity * 100`

**Key UI Elements:** Platform Revenue bento card, Total Deposits/Withdrawals stat cards, AMM Overview (per-market seed P&L), Recent Movements, Platform Risk Ratio indicator.

---

### 4.2 Markets List — `/admin/markets`

**File:** `/src/app/admin/markets/page.tsx` (Server Component)

**Data Fetched:** `markets` (all, created_at DESC), `amm_state` (all)

**Actions:** Navigate to create market, click through to market detail.

---

### 4.3 Create Market — `/admin/markets/create`

**File:** `/src/app/admin/markets/create/page.tsx` (Client Component)

**Form Fields:** `question_en`, `question_ar`, `description_en`, `description_ar`, `category`, `liquidity_param` (100–100000, default 1000), `keywords`, `opens_at`, `closes_at`

**RPC:** `admin_create_market` — atomically creates market + initializes AMM.

---

### 4.4 Market Detail — `/admin/markets/[id]`

**File:** `/src/app/admin/markets/[id]/page.tsx` (Server Component)

**Data Fetched:** `markets`, `amm_state`, `trades` (latest 20 with user info)

**Actions:**
- **Edit Market** → `admin_update_market` (description, close date, keywords)
- **Lock Market** → `lock_market` (status → closed)
- **Void Market** → `void_market` (refund all positions)
- **Resolve Market** → links to resolve page
- **Keywords Editor** → direct table update

---

### 4.5 Resolve Market — `/admin/markets/[id]/resolve`

**File:** `/src/app/admin/markets/[id]/resolve/page.tsx` (Client Component)

**RPC:** `resolve_market` — pays winning positions (×$0.99), settles commissions, records revenue. **Irreversible.**

**UI:** YES/NO selector buttons, warning banner, confirmation dialog listing consequences.

---

### 4.6 Users List — `/admin/users`

**File:** `/src/app/admin/users/page.tsx` (Server Component)

**Data Fetched:** `users` (all, created_at DESC, limit 100)

---

### 4.7 User Detail — `/admin/users/[id]`

**File:** `/src/app/admin/users/[id]/page.tsx` (Server Component)

**Data Fetched:** `users`, `transactions` (latest 20), `trades` (latest 20), direct referrals, sub-referrals, ancestor chain, ledger sum for balance reconciliation.

**Balance Mismatch Detection:** If `|balance_usd - sum(transactions)| > $0.01`, the card is flagged red.

**Actions:**
- **Credit / Debit** → `admin_adjust_balance` (PIN-protected, max $10,000)
- **Freeze / Unfreeze** → `toggle_user_freeze`
- **Override Activation** → `toggle_agent_activation_override` (releases escrowed commissions)

---

### 4.8 Finance — `/admin/finance`

**File:** `/src/app/admin/finance/page.tsx` (Server Component)

**Data Fetched:** `deposits`, `withdrawals`, `transactions` (limit 500, all with user info)

**Actions:** Credit/Debit (with user search), Withdrawal approve/reject via `WithdrawalActions`.

**UI:** Tabbed view — Deposits, Withdrawals (with pending badge), Transaction Ledger.

---

### 4.9 Withdrawals — `/admin/withdrawals`

Redirects to `/admin/finance`.

---

### 4.10 Fees — `/admin/fees`

**File:** `/src/app/admin/fees/page.tsx` (Server Component)

**Data Fetched:** `fee_config` (all rows)

**Actions:** Edit any fee via `admin_update_fee` (PIN-protected). Impactful fees show warning + mandatory checkbox.

**Fee Types:** `explicit_fee`, `resolution_fee`, `cash_out_premium`, `deposit_fee`, `withdrawal_fee`, `amm_default_b`, `amm_max_trade_pct`, `dynamic_spread_threshold`, `dynamic_spread_multiplier`, commission rates (4 tiers × 3 layers).

---

### 4.11 Agents — `/admin/agents`

**File:** `/src/app/admin/agents/page.tsx` (Server Component)

**Data Fetched:** `users` (where `direct_referral_count > 0`), `referral_commissions` (credited, aggregated by tier)

**UI:** Stats cards (Total Agents, Total Commissions, Avg per Agent, Top Earner), Agent Network table with T1/T2/T3 commission breakdown.

---

### 4.12 Stats — `/admin/stats`

**File:** `/src/app/admin/stats/page.tsx` (Client Component)

**RPCs (migration 178):** 6 modular stats RPCs with configurable date range:
- `get_stats_users` — signups, active users, retention
- `get_stats_trading` — volume, trades, unique traders
- `get_stats_markets` — market creation, resolution, status breakdown
- `get_stats_finance` — deposits, withdrawals, net flow
- `get_stats_revenue` — revenue breakdown by fee type
- `get_stats_health` — error rates, system metrics

**Frontend modules:** `module-users.tsx`, `module-trading.tsx`, `module-markets.tsx`, `module-finance.tsx`, `module-revenue.tsx`, `module-health.tsx`

**UI:** KPI Cards with period-over-period trends, Volume Over Time (line chart), Deposits vs Withdrawals (bar chart), Active Users Per Day (area chart), Trades Per Day (bar chart).

---

### 4.13 AMM Risk Dashboard — `/admin/amm`

**File:** `/src/app/admin/amm/page.tsx` (Server Component)

**Data Fetched:** `amm_state` (with market join), `platform_revenue`

**UI:** Summary stats, 5-Layer Revenue Breakdown card, Per-Market AMM State table.

---

### 4.14 Risk Alerts — `/admin/alerts`

**File:** `/src/app/admin/alerts/page.tsx` (Server Component)

**Data Fetched:** `amm_state` + `markets` (lopsided detection), `reconcile_balances()` RPC, `system_logs` (unacknowledged error count)

**Lopsided threshold:** volume ≥ $50 AND (YES price > 0.90 OR < 0.10)

---

### 4.15 System Logs — `/admin/logs`

**File:** `/src/app/admin/logs/page.tsx` (Client Component)

**Data Fetched:** `system_logs` (latest 100, with filters)

**Actions:** Acknowledge log → `acknowledge_system_log`, Copy for debugging.

**Filters:** All | Critical | Errors | Unacknowledged

---

### 4.16–4.21 Help Center

**Pages:** `/admin/help`, `/admin/help/collections/[id]`, `/admin/help/collections/create`, `/admin/help/collections/[id]/edit`, `/admin/help/articles/create`, `/admin/help/articles/[id]/edit`

**Tables:** `help_collections`, `help_articles`

**Actions:** Full CRUD on collections and articles. Markdown editor with live preview for articles.

---

### 4.22–4.24 (removed)

The admin Support pages (`/admin/support`, `/admin/support/[ticketId]`) and the Telegram forwarding flow were removed in migration 301. Support is now a WhatsApp deep link from the user-side; no admin queue exists. See ARCHITECTURE.md §8.

The admin User Map (`/admin/usermap`) was removed in migration 348 — Vercel IP geolocation is unreliable in Lebanon (carrier-grade NAT).

---

## 5. Shared Admin Components

| Component | File | Purpose |
|---|---|---|
| `AdminSidebar` | `admin-sidebar.tsx` | Dark sidebar navigation |
| `AdminPinSetup` | `admin-pin-setup.tsx` | 6-digit PIN setup dialog |
| `AdminCreditModal` | `admin-credit-modal.tsx` | Credit/debit dialog with user search and PIN |
| `QuickCreditButton` | `quick-credit-button.tsx` | Opens credit modal pre-filled with user |
| `FinanceCreditButton` | `finance-credit-button.tsx` | Opens credit modal with user search |
| `MarketActions` | `market-actions.tsx` | Lock/void buttons based on market status |
| `EditMarketButton/Dialog` | `edit-market-button.tsx`, `edit-market-dialog.tsx` | Edit market details |
| `MarketKeywordsEditor` | `market-keywords-editor.tsx` | Tag-style keyword manager |
| `UserActions` | `user-actions.tsx` | Freeze/unfreeze + activation override |
| `WithdrawalActions` | `withdrawal-actions.tsx` | Approve/reject pending withdrawals |
| `FeeConfigEditor` | `fee-config-editor.tsx` | Platform fees + commission rates editor |
| `EditFeeDialog` | `edit-fee-dialog.tsx` | PIN-protected fee editing modal |
| `FinanceTabs` | `finance-tabs.tsx` | Deposits/Withdrawals/Ledger tabs |
| `MarketsTable` | `markets-table.tsx` | Markets list with search |
| `UsersTable` | `users-table.tsx` | Users list with search |

---

## 6. Supabase RPCs Referenced

| RPC Name | Used In | PIN Required |
|---|---|---|
| `admin_create_market` | Create Market | No |
| `admin_update_market` | Edit Market dialog | No |
| `resolve_market` | Resolve Market page | No |
| `lock_market` | MarketActions | No |
| `void_market` | MarketActions | No |
| `admin_adjust_balance` | AdminCreditModal | Yes |
| `admin_update_fee` | EditFeeDialog | Yes |
| `admin_set_pin` | AdminPinSetup | No |
| `admin_has_pin` | EditFeeDialog, AdminCreditModal | No |
| `toggle_user_freeze` | UserActions | No |
| `toggle_agent_activation_override` | UserActions | No |
| `acknowledge_system_log` | Logs page | No |
| `reconcile_balances` | Alerts page | No |
| `get_platform_stats` | Stats page | No |
| `get_stats_users` | Stats page (module) | No |
| `get_stats_trading` | Stats page (module) | No |
| `get_stats_markets` | Stats page (module) | No |
| `get_stats_finance` | Stats page (module) | No |
| `get_stats_revenue` | Stats page (module) | No |
| `get_stats_health` | Stats page (module) | No |

---

## 7. Middleware & Rate Limiting

**File:** `/src/middleware.ts`

The middleware does **not** enforce admin authorization. It handles:
1. **Rate Limiting** on API routes — in-memory store, returns HTTP 429 with `Retry-After: 60`
2. **Session Refresh** — `updateSession(request)` to keep Supabase cookie session alive

Admin route protection is enforced exclusively by the `requireAdmin()` call inside the admin layout's server component.
