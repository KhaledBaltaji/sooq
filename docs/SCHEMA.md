# Database Schema Reference

**Last updated:** 2026-04-06
**Generated from:** ~120 migration files (001 through 191, with gaps)
**Architecture:** Supabase/Postgres with LMSR AMM (V3), NGR commission model, agent activation gate

---

## Table of Contents

1. [Enums (Custom Types)](#1-enums)
2. [Tables by Domain](#2-tables)
3. [RPC Functions](#3-rpc-functions)
4. [RLS Policies Summary](#4-rls-policies-summary)
5. [Triggers](#5-triggers)
6. [Realtime Publications](#6-realtime-publications)
7. [Fee Config Seed Data](#7-fee-config-seed-data)

---

## 1. Enums

| Type | Values |
|---|---|
| `market_status` | `draft`, `open`, `closed`, `resolved`, `voided` |
| `bet_side` | `yes`, `no` |
| `trade_direction` | `buy`, `sell` |
| `alert_direction` | `above`, `below` |
| `withdrawal_status` | `pending`, `approved`, `rejected` |
| `commission_status` | `escrowed`, `credited`, `voided` |
| `transaction_type` | `bet`, `win`, `deposit`, `withdrawal`, `commission`, `bonus`, `refund`, `seed`, `trade`, `cash_out`, `resolution_payout`, `resolution_fee`, `agent_transfer_out`, `agent_transfer_in`, `admin_credit`, `admin_debit`, `commission_release` |
| `log_severity` | `info`, `warn`, `error`, `critical` |
| `agent_level` | `1`, `2`, `3`, `4` (note: `users.agent_level` uses INTEGER, not this enum) |
| `branch_agent_status` | `pending`, `approved`, `rejected`, `suspended` |

---

## 2. Tables

### 2.1 Auth/Users

#### `users`

| Column | Type | Constraints / Default | Notes |
|---|---|---|---|
| `id` | UUID | PK, FK → `auth.users(id)` ON DELETE CASCADE | |
| `phone` | TEXT | nullable | |
| `display_name` | TEXT | nullable, UNIQUE (case-insensitive, partial) | |
| `email` | TEXT | nullable, UNIQUE | |
| `bio` | TEXT | nullable | |
| `avatar_url` | TEXT | nullable | |
| `balance_usd` | DECIMAL(18,6) | NOT NULL DEFAULT 0 | Protected — portfolio wallet |
| `agent_balance_usd` | NUMERIC(12,2) | NOT NULL DEFAULT 0.00 | Protected — commission wallet |
| `referral_code` | TEXT | NOT NULL UNIQUE | Protected |
| `referred_by` | UUID | nullable FK → `users(id)` | One-time set only |
| `referral_chain` | UUID[] | DEFAULT '{}' | Max 3 ancestors. Protected |
| `agent_level` | INTEGER | NOT NULL DEFAULT 1 CHECK (1–4) | Protected — volume-based ratchet |
| `direct_referral_count` | INTEGER | NOT NULL DEFAULT 0 | Protected |
| `network_volume` | DECIMAL(18,2) | NOT NULL DEFAULT 0 | For tier advancement |
| `agent_activated` | BOOLEAN | NOT NULL DEFAULT FALSE | Activation gate |
| `agent_activation_override` | BOOLEAN | NOT NULL DEFAULT FALSE | Admin override |
| `qualified_referral_count` | INTEGER | NOT NULL DEFAULT 0 | Referrals with ≥1 trade |
| `locale` | TEXT | NOT NULL DEFAULT 'en' CHECK ('en','ar') | |
| `is_admin` | BOOLEAN | NOT NULL DEFAULT FALSE | Protected |
| `is_frozen` | BOOLEAN | NOT NULL DEFAULT FALSE | Protected |
| `wagering_requirement` | DECIMAL(18,6) | NOT NULL DEFAULT 0 | Protected |
| `total_wagered` | DECIMAL(18,6) | NOT NULL DEFAULT 0 | Protected |
| `deposit_bonus_claimed` | BOOLEAN | NOT NULL DEFAULT FALSE | Protected |
| `signup_branch_id` | UUID | nullable FK → `branches(id)` ON DELETE RESTRICT (mig 293) | Attribution pointer for commission branches — distinct from `assigned_branch_id` (venue lock). Cannot delete branch while users are attributed; must suspend. |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Protected columns** enforced by `trg_protect_sensitive_user_columns` trigger — only modifiable via SECURITY DEFINER RPCs.

#### `admin_config`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `admin_user_id` | UUID | FK → `users(id)` UNIQUE |
| `pin_hash` | TEXT | bcrypt hash |
| `failed_pin_attempts` | INTEGER | DEFAULT 0 |
| `pin_locked_until` | TIMESTAMPTZ | nullable |

#### `user_wallets`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users(id)` UNIQUE |
| `provider` | TEXT | DEFAULT '3pay' |
| `wallet_address_trc20` | TEXT | nullable |
| `wallet_address_erc20` | TEXT | nullable |

---

### 2.2 Markets/Trading

#### `markets`

| Column | Type | Constraints / Default | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `question_en` | TEXT | NOT NULL | |
| `question_ar` | TEXT | NOT NULL | |
| `description_en` | TEXT | nullable | |
| `description_ar` | TEXT | nullable | |
| `category` | TEXT | NOT NULL DEFAULT 'politics' | |
| `keywords` | TEXT[] | DEFAULT '{}' | For news matching |
| `status` | market_status | NOT NULL DEFAULT 'draft' | |
| `outcome` | bet_side | nullable | Set on resolution |
| `bet_count` | INTEGER | NOT NULL DEFAULT 0 | |
| `unique_bettors` | INTEGER | NOT NULL DEFAULT 0 | |
| `amm_liquidity_param` | DECIMAL(18,6) | DEFAULT 1000 | |
| `homepage_rank` | INTEGER | nullable | Set by cron |
| `image_url` | TEXT | nullable | |
| `opens_at` | TIMESTAMPTZ | NOT NULL | |
| `closes_at` | TIMESTAMPTZ | NOT NULL | CHECK > opens_at |
| `resolved_at` | TIMESTAMPTZ | nullable | |
| `created_by` | UUID | FK → `users(id)` | |

#### `amm_state`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `market_id` | UUID | FK → `markets(id)` UNIQUE |
| `liquidity_param` | DECIMAL(18,6) | DEFAULT 1000 |
| `q_yes` | DECIMAL(18,6) | DEFAULT 0 |
| `q_no` | DECIMAL(18,6) | DEFAULT 0 |
| `current_yes_price` | DECIMAL(10,6) | DEFAULT 0.500000 |
| `current_no_price` | DECIMAL(10,6) | DEFAULT 0.500000 |
| `total_volume` | DECIMAL(18,2) | DEFAULT 0 |
| `total_trades` | INTEGER | DEFAULT 0 |
| `seed_pnl` | DECIMAL(18,2) | DEFAULT 0 |

**Constraints:** prices ∈ [0.000001, 0.999999], liquidity_param > 0

#### `trades`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users(id)` |
| `market_id` | UUID | FK → `markets(id)` |
| `side` | bet_side | NOT NULL |
| `direction` | trade_direction | NOT NULL |
| `shares` | DECIMAL(18,6) | CHECK > 0 |
| `price_per_share` | DECIMAL(10,6) | CHECK > 0 AND < 1 |
| `total_cost` | DECIMAL(18,2) | NOT NULL |
| `explicit_fee` | DECIMAL(18,6) | DEFAULT 0 |
| `amm_spread_cost` | DECIMAL(18,6) | DEFAULT 0 |
| `cash_out_premium` | DECIMAL(18,6) | DEFAULT 0 |
| `is_copy_trade` | BOOLEAN | DEFAULT FALSE |
| `copied_from_user` | UUID | nullable |
| `dynamic_spread` | DECIMAL(18,6) | DEFAULT 0 (migration 187) |
| `post_yes_price` | DECIMAL(10,6) | Post-trade YES marginal price (migration 159) |
| `post_no_price` | DECIMAL(10,6) | Post-trade NO marginal price (migration 159) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

#### `positions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users(id)` |
| `market_id` | UUID | FK → `markets(id)` |
| `side` | bet_side | NOT NULL |
| `shares_held` | DECIMAL(18,6) | CHECK >= 0 |
| `avg_entry_price` | DECIMAL(10,6) | DEFAULT 0 |
| `total_invested` | DECIMAL(18,2) | DEFAULT 0 |
| `realized_pnl` | DECIMAL(18,2) | DEFAULT 0 |

**Constraint:** UNIQUE(user_id, market_id, side)

#### `price_alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users(id)` |
| `market_id` | UUID | FK → `markets(id)` |
| `side` | bet_side | |
| `target_price` | DECIMAL(10,6) | CHECK > 0 AND < 1 |
| `direction` | alert_direction | |
| `is_triggered` | BOOLEAN | DEFAULT FALSE |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `triggered_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

#### `copy_settings`

| Column | Type | Notes |
|---|---|---|
| `copier_id` | UUID | FK → `users(id)` |
| `leader_id` | UUID | FK → `users(id)` |
| `amount_per_trade` | DECIMAL(18,2) | CHECK > 0 |
| `max_per_market` | DECIMAL(18,2) | DEFAULT 100 |
| `max_total` | DECIMAL(18,2) | DEFAULT 1000 |
| `is_active` | BOOLEAN | DEFAULT TRUE |

**Constraints:** UNIQUE(copier_id, leader_id), CHECK(copier_id != leader_id)

#### `leader_stats`

One row per user. Updated by `execute_trade` and `resolve_market`.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID | FK → `users(id)` UNIQUE |
| `total_trades` | INTEGER | DEFAULT 0 |
| `winning_trades` | INTEGER | DEFAULT 0 |
| `accuracy_pct` | DECIMAL(5,2) | DEFAULT 0 |
| `total_pnl` | DECIMAL(18,2) | DEFAULT 0 |
| `copier_count` | INTEGER | DEFAULT 0 |

#### `market_comments`

| Column | Type | Notes |
|---|---|---|
| `market_id` | UUID | FK → `markets(id)` |
| `user_id` | UUID | FK → `users(id)` |
| `side` | TEXT | nullable, CHECK NULL or 'yes'/'no' |
| `body` | TEXT | CHECK 1–500 chars |
| `parent_id` | UUID | nullable FK → self (threading) |
| `like_count` | INTEGER | DEFAULT 0 |

#### `comment_likes`

UNIQUE(comment_id, user_id)

---

### 2.3 Finance

#### `transactions`

Append-only ledger. Source of truth for all balance mutations.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → `users(id)` |
| `type` | transaction_type | NOT NULL |
| `amount` | DECIMAL(18,6) | positive = credit, negative = debit |
| `balance_after` | DECIMAL(18,6) | NOT NULL |
| `reference_id` | UUID | nullable |
| `description` | TEXT | nullable |
| `performed_by` | UUID | nullable (admin actions) |

#### `deposits`

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID | FK → `users(id)` |
| `amount` | DECIMAL(18,6) | CHECK > 0 |
| `fee` | DECIMAL(18,6) | DEFAULT 0 |
| `net_amount` | DECIMAL(18,6) | |
| `currency` | TEXT | DEFAULT 'USDT' |
| `provider_ref` | TEXT | UNIQUE (idempotency key) |
| `provider` | TEXT | DEFAULT '3pay' |
| `status` | TEXT | CHECK ('pending','confirmed','failed') |

#### `withdrawals`

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID | FK → `users(id)` |
| `amount` | DECIMAL(18,6) | CHECK > 0 |
| `fee` | DECIMAL(18,6) | DEFAULT 0 |
| `net_amount` | DECIMAL(18,6) | |
| `destination` | TEXT | |
| `status` | withdrawal_status | DEFAULT 'pending' |
| `admin_notes` | TEXT | nullable |

#### `platform_revenue`

One row per resolved market.

| Column | Type | Notes |
|---|---|---|
| `market_id` | UUID | FK → `markets(id)` UNIQUE |
| `total_pot` | DECIMAL(18,6) | Total AMM volume |
| `platform_fee` | DECIMAL(18,6) | Sum of all fee types |
| `total_commissions` | DECIMAL(18,6) | DEFAULT 0 |
| `net_revenue` | DECIMAL(18,6) | |
| `explicit_fee_revenue` | DECIMAL(18,2) | |
| `amm_spread_revenue` | DECIMAL(18,2) | |
| `resolution_fee_revenue` | DECIMAL(18,2) | |
| `dynamic_spread_revenue` | DECIMAL(18,2) | |
| `cash_out_premium_revenue` | DECIMAL(18,2) | |

---

### 2.4 Commissions

#### `referral_commissions`

| Column | Type | Notes |
|---|---|---|
| `referrer_id` | UUID | FK → `users(id)` |
| `bettor_id` | UUID | FK → `users(id)` |
| `market_id` | UUID | FK → `markets(id)` |
| `trade_id` | UUID | nullable FK → `trades(id)` |
| `layer` | INTEGER | CHECK 1–3 |
| `agent_level_at_time` | INTEGER | CHECK 1–4 |
| `platform_revenue_amount` | DECIMAL(18,6) | |
| `commission_rate` | DECIMAL(5,4) | |
| `commission_amount` | DECIMAL(18,6) | |
| `status` | commission_status | DEFAULT 'escrowed' |
| `revenue_type` | TEXT | CHECK ('trade','resolution') |

#### `fee_config`

| Column | Type | Notes |
|---|---|---|
| `fee_type` | TEXT | NOT NULL |
| `level` | INTEGER | nullable (agent tier 1–4) |
| `depth` | INTEGER | nullable (layer 1–3) |
| `rate` | DECIMAL(18,6) | NOT NULL |
| `description` | TEXT | nullable |

**Constraint:** UNIQUE(fee_type, level, depth)

---

### 2.5 Content & Help

#### `help_collections`

| Column | Type | Notes |
|---|---|---|
| `slug` | TEXT | UNIQUE, CHECK `^[a-z0-9-]+$` |
| `title` | TEXT | NOT NULL |
| `icon` | TEXT | DEFAULT 'help-circle' |
| `sort_order` | INTEGER | DEFAULT 0 |
| `is_published` | BOOLEAN | DEFAULT true |

#### `help_articles`

| Column | Type | Notes |
|---|---|---|
| `collection_id` | UUID | FK → `help_collections(id)` ON DELETE CASCADE |
| `slug` | TEXT | CHECK `^[a-z0-9-]+$` |
| `title` | TEXT | NOT NULL |
| `content` | TEXT | DEFAULT '' |
| `sort_order` | INTEGER | DEFAULT 0 |
| `is_published` | BOOLEAN | DEFAULT true |

**Constraint:** UNIQUE(collection_id, slug). GIN full-text search index.

> **Removed in migration 301:** `support_tickets`, `support_messages`, `support_verification_codes`, `telegram_users`. Support is now a WhatsApp deep link (no DB tables, no RPCs). See ARCHITECTURE.md §8.

#### `news_articles`

| Column | Type | Notes |
|---|---|---|
| `title` | TEXT | NOT NULL |
| `url` | TEXT | UNIQUE (dedup key) |
| `source_name` | TEXT | |
| `market_id` | UUID | nullable FK → `markets(id)` |
| `published_at` | TIMESTAMPTZ | |

---

### 2.6 System

#### `system_logs`

| Column | Type | Notes |
|---|---|---|
| `severity` | log_severity | DEFAULT 'error' |
| `source` | TEXT | e.g. 'pg/execute_trade' |
| `message` | TEXT | |
| `context` | JSONB | DEFAULT '{}' |
| `acknowledged` | BOOLEAN | DEFAULT FALSE |
| `acknowledged_by` | UUID | nullable |

#### `notifications`

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID | FK → `users(id)` |
| `type` | TEXT | |
| `title_en` | TEXT | |
| `title_ar` | TEXT | |
| `body_en` | TEXT | nullable |
| `body_ar` | TEXT | nullable |
| `reference_id` | UUID | nullable |
| `is_read` | BOOLEAN | DEFAULT FALSE |

---

### 2.7 Pre-Launch (migration 185)

#### `prelaunch_questions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `slug` | TEXT | UNIQUE |
| `title_ar` | TEXT | |
| `title_en` | TEXT | |
| `description_ar` | TEXT | nullable |
| `description_en` | TEXT | nullable |
| `category` | TEXT | |
| `yes_count` | INTEGER | DEFAULT 0 |
| `no_count` | INTEGER | DEFAULT 0 |
| `sort_order` | INTEGER | DEFAULT 0 |
| `active` | BOOLEAN | DEFAULT TRUE |
| `expires_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

#### `prelaunch_votes`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `question_id` | UUID | FK → `prelaunch_questions(id)` |
| `visitor_id` | TEXT | Anonymous visitor ID |
| `vote` | TEXT | CHECK ('yes','no') |
| `ip_hash` | TEXT | Hashed IP for dedup |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

**Constraint:** UNIQUE(question_id, visitor_id)

#### `prelaunch_waitlist`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `phone` | TEXT | UNIQUE |
| `position` | SERIAL | Auto-increment queue position |
| `referral_code` | TEXT | UNIQUE |
| `referred_by` | TEXT | nullable |
| `referral_count` | INTEGER | DEFAULT 0 |
| `votes_json` | JSONB | Cached vote data |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

---

## 3. RPC Functions

### 3.1 User-Facing RPCs

| Function | Parameters | Auth | Description |
|---|---|---|---|
| `execute_trade` | `p_market_id, p_side, p_direction, p_amount` | `auth.uid()` | Buy/sell shares on LMSR AMM. Handles fees, positions, commissions. 30s rate limit. |
| `process_withdrawal` | `p_amount, p_destination, p_currency` | `auth.uid()` | Create pending withdrawal. Min $10, wagering check. |
| `claim_deposit_bonus` | _(none)_ | `auth.uid()` | $5 bonus for non-referred users with ≥$20 deposit. |
| `transfer_agent_to_portfolio` | `p_amount` | `auth.uid()` | Move funds from agent to portfolio wallet. |
| `get_amm_price` | `p_market_id` | — | Read-only price query. |
| `get_cash_out_value` | `p_market_id, p_side, p_shares` | — | Preview sell proceeds with fee breakdown. |

### 3.2 Admin RPCs

| Function | Parameters | PIN | Description |
|---|---|---|---|
| `resolve_market` | `p_market_id, p_outcome` | No | Pay winners, settle commissions, record revenue. Irreversible. |
| `void_market` | `p_market_id` | No | Refund positions, claw back commissions. |
| `lock_market` | `p_market_id` | No | Close market to trading. |
| `admin_create_market` | `p_question_en, p_question_ar, ...` | No | Atomic market + AMM creation. |
| `admin_update_market` | `p_market_id, p_description_en, ...` | No | Edit market details. |
| `admin_adjust_balance` | `p_user_id, p_amount, p_description, p_pin` | Yes | Credit/debit up to $10,000. |
| `admin_update_fee` | `p_fee_id, p_new_rate, p_pin` | Yes | Update fee config rate. |
| `admin_set_pin` | `p_pin` | No | Set admin PIN (bcrypt). |
| `admin_has_pin` | _(none)_ | No | Check if PIN exists. |
| `toggle_user_freeze` | `p_user_id, p_frozen` | No | Freeze/unfreeze user. |
| `toggle_agent_activation_override` | `p_user_id, p_override` | No | Override activation gate. |
| `acknowledge_system_log` | `p_log_id` | No | Mark log as acknowledged. |
| `get_platform_stats` | `p_start_date, p_end_date` | No | Time-windowed platform KPIs. |
| `process_deposit` | `p_user_id, p_amount, p_currency, p_provider_ref, p_provider` | No | Webhook deposit processing. Idempotent. |
| `dead_market_check` | _(none)_ | No | Auto-void stale low-volume markets. |
| `update_homepage_ranks` | _(none)_ | No | Rerank open markets by trade_count DESC (migration 183). |

### 3.2b Admin Stats RPCs (migration 178)

| Function | Parameters | Description |
|---|---|---|
| `get_stats_users` | `p_start_date, p_end_date` | Signups, active users, retention metrics |
| `get_stats_trading` | `p_start_date, p_end_date` | Volume, trades, unique traders by period |
| `get_stats_markets` | `p_start_date, p_end_date` | Market creation, resolution, status breakdown |
| `get_stats_finance` | `p_start_date, p_end_date` | Deposits, withdrawals, net flow by period |
| `get_stats_revenue` | `p_start_date, p_end_date` | Revenue breakdown by fee type |
| `get_stats_health` | `p_start_date, p_end_date` | Error rates, system health metrics |

### 3.2c Pre-Launch RPCs (migration 185)

| Function | Parameters | Description |
|---|---|---|
| `record_prelaunch_vote` | `question_id, vote, visitor_id` | Atomic vote insert + counter increment |
| `increment_referral_count` | `referral_code` | Increment waitlist referral_count |

### 3.2d Search RPCs

| Function | Parameters | Description |
|---|---|---|
| `search_news_for_market` | `question, market_id, limit` | Full-text news search with market_id priority (migration 186) |

### 3.3 Internal Helpers

| Function | Description |
|---|---|
| `_void_market_internal` | Core void logic (no auth check) |
| `_credit_commission` | Insert commission row, credit agent wallet or escrow |
| `pay_trade_commissions` | Per-trade commission distribution across referral chain |
| `settle_resolution_commissions` | Resolution commission on winning positions |
| `record_revenue` | Insert platform_revenue row with 5-layer breakdown |
| `_is_agent_activated` | Check activation status |
| `_release_escrowed_commissions` | Bulk credit escrowed → credited |
| `update_agent_level` | Recalculate tier from network_volume (ratchet) |
| `handle_referral_signup` | Trigger: populate referral_chain, increment counts |
| `log_system_event` | Insert system_logs row |
| `prevent_sensitive_user_updates` | Trigger: block protected column changes |
| `reconcile_balances` | Audit balance_usd vs ledger sum |
| `reconcile_agent_balances` | Audit agent_balance_usd vs ledger sum |

### 3.4 LMSR Math Functions (IMMUTABLE)

| Function | Description |
|---|---|
| `lmsr_cost(b, q_yes, q_no)` | Cost function C(q) = b × ln(e^(q_yes/b) + e^(q_no/b)) |
| `lmsr_price(b, q_yes, q_no, side)` | Price (probability) via sigmoid |
| `lmsr_shares_for_cost(b, q_yes, q_no, side, cost)` | Inverse: USD → shares |

### 3.5 Agent Dashboard RPCs

| Function | Auth | Description |
|---|---|---|
| `get_agent_stats` | `auth.uid()` | Agent wallet, commissions, network stats, activation status |
| `get_agent_network_tree` | `auth.uid()` | 3-level referral tree with commission stats |
| `get_agent_commission_feed` | `auth.uid()` | Paginated commission activity feed |

---

## 4. RLS Policies Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `users` | Anyone | Own | Own (protected cols via trigger) | — |
| `markets` | Anyone | Admins | Admins | — |
| `amm_state` | Anyone | Service role | Service role | — |
| `trades` | Anyone | Service role | Service role | — |
| `positions` | Own | Service role | Service role | — |
| `transactions` | Own; admins all | No direct | — | — |
| `deposits` | Own; admins all | — | — | — |
| `withdrawals` | Own; admins all | — | — | — |
| `referral_commissions` | Own (referrer); admins all | — | — | — |
| `platform_revenue` | Admins only | — | — | — |
| `fee_config` | Anyone | — | Admins | — |
| `notifications` | Own; admins all | — | Own (mark read) | — |
| `system_logs` | Admins | Any | Admins | — |
| `help_collections` | Published (public) | Admins | Admins | Admins |
| `help_articles` | Published (public) | Admins | Admins | Admins |
| `prelaunch_questions` | Public | Public | — | — |
| `prelaunch_votes` | Public | Public | — | — |
| `prelaunch_waitlist` | Public | Public | — | — |

**Key pattern:** Financial table writes only via SECURITY DEFINER RPCs with `app.trigger_bypass = 'true'`.

---

## 5. Triggers

| Trigger | Table | Description |
|---|---|---|
| `trg_protect_sensitive_user_columns` | `users` | Blocks modification of protected columns unless service_role/admin/bypass |
| `trg_handle_referral_signup` | `users` | AFTER UPDATE: populates referral_chain, increments counts, updates agent level |
| `*_updated_at` | Multiple | BEFORE UPDATE: sets `updated_at = NOW()` |

---

## 6. Realtime Publications

| Table | Purpose |
|---|---|
| `markets` | Status updates, real-time |
| `amm_state` | Live price feed |
| `trades` | Live activity feed |
| `positions` | Live position updates |
| `notifications` | Push in-app notifications |
| `deposits` | Deposit confirmation (migration 106) |
| `market_comments` | Live comment updates (migration 188) |
| `referral_commissions` | Commission updates (migration 188) |
| `users` | Profile/balance updates (migration 188) |

---

## 6b. Indexes

| Index | Table | Columns | Migration |
|---|---|---|---|
| `idx_news_articles_fts` | `news_articles` | GIN full-text on (title \|\| summary) | 186 |
| `idx_referral_commissions_referrer_status` | `referral_commissions` | `(referrer_id, status)` | 191 |
| `idx_referral_commissions_market_status` | `referral_commissions` | `(market_id, status)` | 191 |
| `idx_market_comments_market_id` | `market_comments` | `(market_id, created_at DESC)` | 191 |
| GIN full-text | `help_articles` | `(title, content)` | 140 |

---

## 7. Fee Config Seed Data

### Core Trading Fees

| fee_type | rate | Description |
|---|---|---|
| `explicit_fee` | 0.005 | 0.5% on every buy/sell |
| `resolution_fee` | 0.010 | 1% on winning shares at resolution |
| `cash_out_premium` | 0.005 | 0.5% additional on sells |
| `deposit_fee` | 0.000 | No deposit fee |
| `withdrawal_fee` | 0.010 | 1% withdrawal fee |

### AMM Parameters

| fee_type | rate | Description |
|---|---|---|
| `amm_default_b` | 1000 | Default liquidity parameter |
| `amm_max_trade_pct` | 0.050 | Max 5% of b per trade |
| `dynamic_spread_threshold` | 0.650 | Trigger at 65/35 imbalance |
| `dynamic_spread_multiplier` | 1.500 | 1.5× spread multiplier |

### NGR Commission Rates

| Tier | Layer 1 (Direct) | Layer 2 (Indirect) | Layer 3 (Deep) |
|---|---|---|---|
| L1 (< $10K) | 20% | 5% | 2% |
| L2 ($10K–$50K) | 25% | 8% | 3% |
| L3 ($50K–$200K) | 35% | 10% | 5% |
| L4 ($200K+) | 45% | 15% | 7% |

Same matrix applies to both `ngr_commission` (trade-time) and `ngr_resolution_commission` (resolution-time).

---

## Notes on Versioning

- **V2 (pool model)** — fully dropped in migration 100. `bets` table, pool columns, V2 RPCs all removed.
- **V3 (LMSR AMM)** — migrations 101–116. New: `amm_state`, `trades`, `positions`, `execute_trade`, LMSR math helpers.
- **NGR Commission** — migrations 129–135. Network-volume-based agent levels, trade-time + resolution-time commissions.
- **Agent Wallet** — migration 143. `agent_balance_usd`, `transfer_agent_to_portfolio`.
- **Activation Gate** — migration 150. Escrowed commissions until 5 qualified referrals (reduced from 10 in migration 184).
- **Bugfixes** — migration 157. Fixed `_void_market_internal` RETURNING clause, dropped 3 zombie function overloads.
- **Price Charts** — migrations 158–164. `get_price_history` with period buckets, `post_yes_price`/`post_no_price` on trades.
- **Support System** — migrations 168, 175. Tickets, messages, OTP verification, AI agent fields.
- **Resolution Fixes** — migrations 176, 179–180. Notifications, PIN requirement, column name + search_path fixes.
- **Admin Stats** — migration 178. 6 modular stats RPCs for admin dashboard.
- **Pre-Launch** — migration 185. Waitlist, questions, voting system.
- **V1 Stabilize** — migration 187. `dynamic_spread` column on trades, UPDATE...RETURNING for balance concurrency.
- **Realtime Expansion** — migration 188. Added deposits, market_comments, support_tickets, referral_commissions, users to publication.
- **Dust Cleanup** — migration 189. Zero out sub-0.001 share positions.
- **Indexes** — migration 191. Performance indexes on referral_commissions, market_comments.
- **S2 Branch System** — migrations 202–221. Branch/bookmaker infrastructure: parallel execution mode, separate liability pools, shared LMSR AMM. Phase 4 (219–221): branch-aware resolution, void, revenue accounting.

---

## Branch System Tables

### `branches`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | Display name |
| `code` | TEXT UNIQUE | URL slug for white-label routes. Commission branches enforce `^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$` via CHECK; reseller slugs grandfathered |
| `book_type` | branch_book_type | `reseller` \| `bookmaker` \| `commission` (mig 289). Immutable post-insert (trigger). Default `reseller`. |
| `manager_user_id` | UUID FK→users | Branch operator |
| `status` | branch_status | `active`/`payback`/`frozen`/`suspended`. Commission branches cannot be `payback` (CHECK) |
| `markup_pct` | DECIMAL | Default 0.05 (5%). Must be 0 for commission branches (CHECK) |
| `fee_rate` | DECIMAL | Override for explicit fee. Must be 0 for commission branches (CHECK) |
| `pool_balance` | DECIMAL | Cache — sum of branch_pools. Must be 0 for commission branches (CHECK) |
| `worst_case_total` | DECIMAL | Max payout across all markets. Must be 0 for commission branches (CHECK) |
| `pending_payouts` | DECIMAL | Owed to SOOQ during payback. Must be 0 for commission branches (CHECK) |
| `payback_activated_at` | TIMESTAMPTZ | When payback mode started |
| `payback_reason` | TEXT | Why payback activated |
| `frozen_at` | TIMESTAMPTZ | When frozen status started (for escalation timing) |
| `solvency_override_pct` | DECIMAL | Admin override threshold. Must be NULL for commission branches (CHECK) |
| `solvency_override_until` | TIMESTAMPTZ | Override expiry. Must be NULL for commission branches (CHECK) |
| `solvency_override_by` | UUID | Admin who set override |
| `display_mode` | TEXT | `trading`/`betting` |
| `created_at` | TIMESTAMPTZ | |

**Commission branch CHECKs (mig 293):**
- `branches_commission_no_capital` — all pool/markup/fee/solvency fields zero or NULL
- `branches_commission_no_payback` — status cannot be `payback`
- `branches_commission_slug_format` — `branch_code` must match `^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$`

**Reserved slug trigger (mig 293):** `_reject_reserved_branch_slug` BEFORE INSERT OR UPDATE of `branch_code` on all branch types. Blocklist mirrors `RESERVED_SLUGS` in `src/lib/slug-rules.ts` — update both together.

### `branch_pools` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `branch_id` | UUID FK→branches | |
| `market_id` | UUID FK→markets | Nullable |
| `type` | branch_pool_entry_type | `trade_buy`/`trade_sell`/`exit_fee`/`withdrawal`/`withdrawal_fee`/`adjustment` |
| `amount` | DECIMAL | Signed |
| `balance_after` | DECIMAL | Running balance |
| `reference_id` | UUID | FK to trade/transaction |
| `created_at` | TIMESTAMPTZ | |

### `branch_agents`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `branch_id` | UUID FK→branches | |
| `user_id` | UUID FK→users | |
| `parent_agent_id` | UUID FK→branch_agents | For sub-agents |
| `agent_type` | branch_agent_type | `pl`/`commission`. For commission branches must be `commission` (trigger). |
| `rate` | DECIMAL | Commission/PL share rate |
| `deposit_required` | DECIMAL | Must be 0 for commission branches (trigger) |
| `deposit_held` | DECIMAL | Must be 0 for commission branches (trigger) |
| `cumulative_pl` | DECIMAL | Running P&L |
| `referral_code` | TEXT | Sub-agent's invite code. For commission branches, signup via `/b/[slug]/?agent=[code]` sets `referred_by` + `signup_branch_id`; for reseller branches, same code creates `branch_user_assignments` row instead. |
| `status` | branch_agent_status | NOT NULL DEFAULT `pending` |
| `rejection_reason` | TEXT | Optional reason when rejected |
| `approved_at` | TIMESTAMPTZ | When approved |
| `approved_by` | UUID FK→users | Who approved |
| `created_at` | TIMESTAMPTZ | |

**Commission-branch trigger (mig 293):** `_enforce_commission_branch_agent_rules` BEFORE INSERT OR UPDATE. Rejects `agent_type='pl'` and non-zero deposits when parent branch has `book_type='commission'`.

### `branch_user_assignments`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK→users | UNIQUE(user_id, branch_id) |
| `branch_id` | UUID FK→branches | |
| `agent_id` | UUID FK→branch_agents | Nullable |
| `created_at` | TIMESTAMPTZ | |

### `branch_trades` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `trade_id` | UUID FK→trades | |
| `branch_id` | UUID FK→branches | |
| `user_id` | UUID FK→users | |
| `agent_id` | UUID FK→branch_agents | Nullable |
| `market_id` | UUID FK→markets | |
| `side` | bet_side | `yes`/`no` |
| `direction` | TEXT | `buy`/`sell` |
| `gross_amount` | DECIMAL | User's total spend |
| `branch_markup` | DECIMAL | Markup extracted (buy only) |
| `exit_fee_amount` | DECIMAL | Exit fee (sell only) |
| `net_canonical_amount` | DECIMAL | Amount hitting LMSR |
| `shares_issued` | DECIMAL | |
| `canonical_pre_price` | DECIMAL | |
| `canonical_post_price` | DECIMAL | |
| `idempotency_key` | TEXT | UNIQUE(branch_id, idempotency_key) |

### `branch_market_config`
| Column | Type | Notes |
|--------|------|-------|
| `branch_id` | UUID FK→branches | PK with market_id |
| `market_id` | UUID FK→markets | |
| `is_enabled` | BOOLEAN | Default false |
| `cash_out_enabled` | BOOLEAN | Default true |
| `custom_markup_pct` | DECIMAL | Per-market override |

### `credit_chain_ledger` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `branch_id` | UUID FK→branches | |
| `issuer_id` | UUID FK→users | |
| `recipient_id` | UUID FK→users | |
| `amount` | DECIMAL | |
| `issuer_role` | credit_chain_role | `admin`/`branch_manager`/`agent`/`sub_agent`/`user` |
| `recipient_role` | credit_chain_role | |
| `description` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

### `branch_admin_overrides` (append-only)
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `branch_id` | UUID FK→branches | |
| `admin_user_id` | UUID FK→users | |
| `override_type` | TEXT | `status_change`/`solvency_gate_loosened`/`withdrawal_lock_bypassed`/`pool_adjustment` |
| `details` | JSONB | |
| `created_at` | TIMESTAMPTZ | |

### `branch_revenue`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `branch_id` | UUID FK→branches | UNIQUE(branch_id, market_id) |
| `market_id` | UUID FK→markets | |
| `markup_revenue` | DECIMAL | From branch buy trades (5% markup) |
| `explicit_fee_revenue` | DECIMAL | From branch trades explicit fee |
| `exit_fee_revenue` | DECIMAL | From branch sell trades exit fee |
| `resolution_fee_revenue` | DECIMAL | 1% fee on winning shares |
| `total_revenue` | DECIMAL | Sum of all fees |
| `created_at` | TIMESTAMPTZ | |

### Retail Isolation Views
| View | Definition |
|------|------------|
| `retail_trades` | `SELECT * FROM trades WHERE branch_id IS NULL` |
| `retail_positions` | `SELECT * FROM positions WHERE branch_id IS NULL` |

### Branch Agent RPCs
| RPC | Purpose |
|-----|---------|
| `apply_branch_agent(p_branch_id)` | User applies to become a branch agent — creates row with status=`pending` |
| `approve_branch_agent(p_agent_id, p_agent_type, p_rate, p_deposit_required)` | Branch manager approves with deal terms, sets status=`approved`, is_active=true |
| `reject_branch_agent(p_agent_id, p_reason)` | Branch manager rejects with optional reason, sets status=`rejected` |
| `update_branch_agent_deal(p_agent_id, p_agent_type, p_rate, p_deposit_required)` | Update deal terms for an approved agent |

### Admin Views
| Function | Definition |
|----------|------------|
| `admin_list_branches()` | SECURITY DEFINER function returning JSONB array. One entry per branch with computed stats (user_count, trade_count, total_volume, total_revenue, utilization_pct). Admin auth enforced at DB level. Replaces original VIEW approach (views bypass RLS). |

---

## Demo Mode System Tables (migration 270)

Isolated `demo_*` universe. See `docs/ARCHITECTURE.md` §18 and `docs/designs/demo-mode.md` for design rationale.

### Enum
```
demo_transaction_type = ENUM ('demo_bet', 'demo_win', 'demo_reset', 'demo_seed')
```
Separate from live `transaction_type` to keep the live ledger enum pure.

### users columns added
| Column | Type | Notes |
|--------|------|-------|
| `demo_mode` | BOOLEAN NOT NULL DEFAULT FALSE | User-writable preference flag; NOT a balance gate |
| `demo_balance_usd` | DECIMAL(18,6) NOT NULL DEFAULT 0 | Precision matches `balance_usd`; protected by `prevent_sensitive_user_updates` trigger |
| `demo_first_enabled_at` | TIMESTAMPTZ | Set atomically by `toggle_demo_mode` on first enable. Route gate. Trigger-protected. |
| `demo_first_trade_at` | TIMESTAMPTZ | Conversion analytics. Set by `demo_execute_trade`. Trigger-protected. |
| `first_real_deposit_after_demo_at` | TIMESTAMPTZ | Conversion analytics. Set by `process_deposit` via folded UPDATE. Trigger-protected. |

Partial index: `CREATE INDEX idx_users_demo_first_enabled ON users(demo_first_enabled_at) WHERE demo_first_enabled_at IS NOT NULL`.

### demo_markets
Mirrors current `markets` shape. Additions:
- `resolves_at TIMESTAMPTZ NOT NULL` — denormalized on this table so users see the countdown without seeing the outcome
- `resolution_fee_rate_snapshot` always `0` (demo has no resolution fee)
- CHECK constraint `resolves_at >= closes_at`
- Indexes: status, closes_at, resolves_at, category, short_code
- Unique index on `question_en` (migration 272) for idempotent seed re-runs

### demo_market_scheduled_outcomes
**Admin-only answer key.** Separate table so users cannot read `scheduled_outcome` via RLS.
```
market_id UUID PRIMARY KEY REFERENCES demo_markets(id) ON DELETE CASCADE
scheduled_outcome bet_side NOT NULL
created_by UUID NOT NULL REFERENCES users(id)
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
RLS: admin-only for ALL operations. Admins read via `admin_list_demo_markets_with_outcomes` RPC.

### demo_amm_state
Mirrors `amm_state`. Default `liquidity_param = 5000` (5× live depth). Public authenticated read.

### demo_positions
Mirrors `positions`. UNIQUE(user_id, market_id, side). Own-row + admin read; writes via SECURITY DEFINER RPCs only.

### demo_trades
Mirrors `trades`. Columns: id, user_id, market_id, side, direction, shares, price_per_share, total_cost, post_yes_price, post_no_price, created_at.

### demo_transactions
Append-only ledger using `demo_transaction_type`.

### RLS matrix
| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|----------------------|
| `demo_markets` | authenticated only | admin only |
| `demo_market_scheduled_outcomes` | **admin only** (blocks all users) | admin only |
| `demo_amm_state` | authenticated only | SECURITY DEFINER RPCs only |
| `demo_positions` | own rows + admin | SECURITY DEFINER RPCs only |
| `demo_trades` | own rows + admin | SECURITY DEFINER RPCs only |
| `demo_transactions` | own rows + admin | SECURITY DEFINER RPCs only |

### Realtime publication
`ALTER PUBLICATION supabase_realtime ADD TABLE demo_markets, demo_amm_state, demo_positions`

### Demo RPCs (migration 271)

| RPC | Purpose |
|-----|---------|
| `toggle_demo_mode(p_enabled boolean) → jsonb` | Atomic first-enable grants $10K. Concurrent calls: `WHERE demo_first_enabled_at IS NULL` guard ensures single grant. |
| `demo_reset_balance() → jsonb` | Reset to $10K; inserts `demo_reset` tx. Rejects if demo not initialized. |
| `demo_execute_trade(p_market_id, p_side, p_amount, p_shares_to_sell) → jsonb` | Pure LMSR. Zero fees/commissions/revenue. Updates `demo_first_trade_at` via COALESCE guard. |
| `initialize_demo_amm(p_market_id, p_liquidity_param) → jsonb` | Mirrors `initialize_amm` for `demo_amm_state`. |
| `admin_create_demo_market(...)` | Atomic: demo_markets + schedule + amm_state + synthetic initial-price trade. |
| `admin_resolve_demo_market(p_market_id) → jsonb` | Reads scheduled_outcome, credits winners at $1/share (no resolution fee). Idempotent. |
| `demo_get_price_history(p_market_id, p_period, p_created_at) → table` | Same bucketing as `get_price_history`, reads from `demo_trades`. |
| `get_demo_conversion_stats() → jsonb` | Admin-only funnel: enabled, traded, deposited, rates, 7d+30d cohorts. |
| `admin_list_demo_markets_with_outcomes() → table` | Admin-only. Joins demo_markets + demo_market_scheduled_outcomes. |
| `demo_seed_initial_price(p_market_id) → void` | Inserts synthetic trade at 0.5 so charts never render blank. |
| `_demo_assert_admin() → uuid` | Internal helper. Accepts super-admin or sub-admin with `'demo'` in `admin_allowed_views`. |

### Edited RPC

`process_deposit` (migration 271): folds `first_real_deposit_after_demo_at = COALESCE(..., CASE WHEN demo_first_enabled_at IS NOT NULL THEN NOW() ELSE NULL END)` into the existing single UPDATE. Zero behavioral change for non-demo users.

### Trigger extension

`prevent_sensitive_user_updates` (migration 270) adds to blocklist:
- `demo_balance_usd`
- `demo_first_enabled_at`
- `demo_first_trade_at`
- `first_real_deposit_after_demo_at`

`demo_mode` is intentionally NOT in the blocklist (preference flag; route gate is `demo_first_enabled_at` anyway).
