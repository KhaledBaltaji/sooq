# Build Plan v1 — MENA Prediction Market

> **This is the implementation plan.** Start here when building.
> Reviewed by: CEO, Engineering, Design, Codex (all CLEARED).
> All decisions consolidated from `docs/review-decisions.md`.
> Commission model spec: `docs/commission-model.md`.

## Stream Architecture

```
Stream 0 (Foundation) ──┬──> Stream 1 (Database + Financial Logic)
   completes first      ├──> Stream 2 (Auth + User Profile)
                        ├──> Stream 3 (Markets + Betting UI)
                        ├──> Stream 4 (Wallet + Payments)
                        ├──> Stream 5 (Admin Dashboard)
                        └──> Stream 6 (Social + Growth)
```

Streams 1-6 run **simultaneously** after Stream 0. Each builds against shared
TypeScript types from Stream 0 and mocks RPC calls until Stream 1 delivers.

---

## Stream 0: Foundation (runs first, solo)

**Builds:** Project scaffolding, design tokens, Supabase client, shared types, i18n, shadcn/ui.

**Files:**
```
package.json, tsconfig.json, next.config.ts, tailwind.config.ts, postcss.config.js
.env.local.example, .gitignore

src/app/layout.tsx                          — Root layout (fonts, theme, providers)
src/app/globals.css                         — CSS custom properties from DESIGN.md

src/lib/supabase/client.ts                  — Browser client (createBrowserClient)
src/lib/supabase/server.ts                  — Server client (createServerClient)
src/lib/supabase/middleware.ts              — Session refresh
src/middleware.ts                           — Auth refresh + locale detection

src/types/database.ts                       — Full types: all tables, enums, RPC signatures
                                              MUST include: referral_chain UUID[], agent_level,
                                              commission depth tiers, fee_config commission rows
src/types/market.ts, user.ts, transaction.ts, admin.ts

src/lib/constants.ts                        — BET_PRESETS, DEPOSIT_PRESETS, MIN values, agent level thresholds
src/lib/utils.ts                            — cn(), formatCurrency, formatCountdown, calculatePotentialPayout
src/lib/fonts.ts                            — Satoshi, DM Sans, Noto Sans Arabic

src/i18n/config.ts                          — i18n setup with locale detection
src/i18n/messages/en.json, ar.json

src/components/providers/index.tsx          — Composed providers (Theme, Supabase, i18n)
src/components/providers/theme-provider.tsx
src/components/providers/supabase-provider.tsx

src/components/ui/                          — shadcn/ui components (zinc base, customized)
```

**Key config:**
- Tailwind: DESIGN.md tokens (bg-surface, text-yes, text-no, etc.)
- Base font 14px, spacing 4px, border radius tokens
- RTL via `dir` attribute + Tailwind `rtl:` variant

**Done when:** `npm run dev` shows themed page, dark bg #09090B, fonts load, Supabase initializes.

---

## Stream 1: Database + Financial Logic (CRITICAL PATH)

**Builds:** All tables, indexes, RLS, Postgres functions. This is the money.

**CRITICAL RULES (from reviews):**
- All user-facing RPCs use `auth.uid()`, NEVER accept client user_id
- All balance ops use `SELECT ... FOR UPDATE` row locking
- All fee/commission rates from `fee_config` table, NEVER hardcoded
- `resolve_market` decomposed into 4 sub-functions in one transaction
- Division-by-zero guard on payout ratio calculation
- NO same_side constraint on bets table (explicit comment required)

**Migrations:**
```
supabase/config.toml
supabase/seed.sql                           — Test users, markets, fee_config with all commission rates

supabase/migrations/
  001_users.sql                             — users + referral_code + referred_by + agent_level (1-4)
                                              + referral_chain UUID[] (max 3 ancestors)
  002_markets.sql                           — markets + status enum + seed amounts
  003_bets.sql                              — bets + indexes
                                              -- NO same_side constraint per CEO review
  004_transactions.sql                      — Append-only ledger (bet, win, deposit, withdrawal,
                                              commission, bonus, refund, seed)
  005_deposits.sql                          — deposits + threepay_ref unique
  006_withdrawals.sql                       — withdrawals + status tracking
  007_referrals.sql                         — referral_commissions + depth (1/2/3)
                                              + agent_level_at_time + net_exposure + commission_rate
                                              + status (escrowed/credited/voided)
  008_platform_revenue.sql                  — per-market revenue record
  009_fee_config.sql                        — platform_fee_pct (7%), deposit/withdrawal fees,
                                              ALL 12 commission rate rows (4 levels × 3 depths)
  010_notifications.sql                     — in-app notifications

  020_fn_place_bet.sql                      — Uses auth.uid(). Validates: market open, time window,
                                              balance (FOR UPDATE), dynamic max bet, min bet,
                                              zero-pool guard. Locks payout_ratio. Inserts bet +
                                              transaction. Updates pool totals + balance cache.
                                              Rate limit: 1 bet/user/market/minute.
  021_fn_resolve_market.sql                 — Orchestrator: calls calculate_payouts,
                                              distribute_payouts, settle_commissions, record_revenue
                                              in single BEGIN/COMMIT. Empty-side → void.
  021a_fn_calculate_payouts.sql             — available_pot = (total - seeds) × (1 - fee_pct).
                                              Scaling factor if SUM(locked payouts) > available_pot.
  021b_fn_distribute_payouts.sql            — Credits each winner. Inserts ledger entries.
  021c_fn_settle_commissions.sql            — For each bettor: calculate net_exposure.
                                              Walk referral_chain (max 3). For each ancestor:
                                              read agent_level, lookup rate from fee_config,
                                              calculate commission, insert referral_commission
                                              (escrowed→credited), insert transaction, update balance.
  021d_fn_record_revenue.sql                — Insert platform_revenue record.
  022_fn_lock_market.sql                    — Sets status='closed'
  023_fn_process_deposit.sql                — Idempotent on tx_ref. Applies fee.
                                              Checks first-deposit bonus eligibility:
                                              amount >= $20 AND user has NO referrer.
  024_fn_process_withdrawal.sql             — Uses auth.uid(). FOR UPDATE. Validates balance,
                                              24hr delay, wagering requirement. Creates pending record.
  025_fn_withdrawal_approve.sql             — Admin only. Deducts balance, updates status.
  026_fn_withdrawal_reject.sql              — Admin only. Updates status.
  027_fn_void_market.sql                    — Refunds all bets, voids escrowed commissions.
  028_fn_claim_deposit_bonus.sql            — Uses auth.uid(). $5 bonus, 2x wagering.
                                              ONLY for non-referred users, $20+ first deposit.
  029_fn_dynamic_max_bet.sql                — time_factor × balance_factor × 20% pool, floor $100
  030_fn_dead_market_check.sql              — Auto-cancel <$100 non-seed after 48hr
  031_fn_reconcile_balances.sql             — Compare balance_usd vs SUM(transactions)
  032_fn_update_agent_level.sql             — Recalculate agent_level based on direct referral count.
                                              Called on new user signup via referral code.

  040_rls_policies.sql                      — Per-table RLS
  050_realtime.sql                          — Enable on markets, bets
  051_cron.sql                              — pg_cron: dead_market_check hourly, reconcile daily
  052_leaderboard_view.sql                  — Materialized view for leaderboard stats.
                                              Excludes both-side markets from accuracy.
                                              Refreshed by resolve_market trigger.
```

**Tests (38 total):**
```
src/tests/db/
  place-bet.test.ts                         — Happy path, insufficient balance, market locked,
                                              last-30-min, dynamic max, ratio accuracy,
                                              both-side allowed (regression), zero-pool guard,
                                              concurrent bets (FOR UPDATE), rate limit,
                                              last-2hr light-side-only
  resolve-market.test.ts                    — YES/NO wins, empty-side void, scaling factor,
                                              commission release (multi-level), fee accuracy,
                                              seed exclusion, net-exposure commission cap,
                                              double-resolve idempotency, single-bet market,
                                              DECIMAL rounding
  payout-invariants.test.ts                 — Property-based: payouts + fee + seed = total_pot,
                                              scaling ≤ 1.0, no payout > potential, losers = $0,
                                              commission ≤ tier_rate × net_exposure per user per market,
                                              total commission ≤ 3.05% of any bet,
                                              SUM(transactions) = balance_usd
  deposit-withdrawal.test.ts                — Idempotency, fee calc, wagering, 24hr delay,
                                              concurrent withdrawal + bet race, invalid currency,
                                              bonus only for non-referred $20+ deposits
  race-conditions.test.ts                   — Concurrent bet+resolution, double-deposit,
                                              concurrent bet+bet same user
  commission.test.ts                        — Multi-level: 3-deep chain, all level combinations,
                                              net-exposure cap at each tier, agent level upgrade,
                                              voided market → voided commissions,
                                              referral_chain integrity
```

**Priority:** Tables → place_bet + resolve_market (+ sub-functions) → commission tests → remaining → RLS

---

## Stream 2: Auth + User Profile

**Files:**
```
src/app/(auth)/login/page.tsx               — Phone input (+961 default, country selector)
src/app/(auth)/verify/page.tsx              — OTP input (6-digit, auto-submit, countdown, retry)
src/app/(auth)/layout.tsx                   — Centered minimal auth layout

src/lib/auth/actions.ts                     — sendOTP, verifyOTP (Supabase Auth phone)
src/lib/auth/guards.ts                      — requireAuth() server helper
src/lib/auth/hooks.ts                       — useUser(), useSession()

src/components/auth/phone-input.tsx         — Phone with country code
src/components/auth/otp-input.tsx           — 6-digit, auto-focus, paste
src/components/auth/auth-guard.tsx          — Client redirect wrapper

src/app/(app)/profile/page.tsx              — Display name, language, theme, referral code, logout
src/components/profile/language-toggle.tsx
src/components/profile/theme-toggle.tsx
```

**Referral signup:** When user signs up via `?ref=CODE`, on account creation:
1. Set `referred_by` to the referrer's user ID
2. Build `referral_chain` from referrer's own chain (max 3 ancestors)
3. Increment referrer's direct referral count → trigger `update_agent_level`

---

## Stream 3: Markets + Betting UI

**Design rules (from design review):**
- Screen hierarchy: Question first (Arabic, Satoshi Bold 24-32px) → pool bar → bet panel → feed
- First-time (zero balance): Let users interact with full bet flow, confirm button = "Deposit $X to Bet"
- RTL: Pool bar stays fixed (YES left blue, NO right amber). Text/nav/icons mirror.

**Files:**
```
src/app/(app)/page.tsx                      — Active markets, resolved, activity feed
src/app/(app)/market/[id]/page.tsx          — Market detail + bet placement
src/app/(app)/layout.tsx                    — Bottom nav (mobile), top nav (desktop), balance chip

src/components/market/
  market-card.tsx                           — bg-surface, rounded-lg, fade-up entrance
  pool-bar.tsx                              — bg-yes/bg-no, rounded-full, 300ms ease-out
  countdown-timer.tsx                       — Pulse animation
  payout-calculator.tsx                     — Satoshi Black 48px, odometer animation
  bet-panel.tsx                             — Side selector, $5/$10/$25/$50 presets, max bet
  bet-confirmation.tsx                      — Bottom sheet, swipe-to-confirm (Framer Motion drag)
  bet-success.tsx                           — Confetti 600ms + "You're in!"
  pool-chart.tsx                            — Sparkline (recharts)
  share-button.tsx                          — WhatsApp/Telegram
  market-status-badge.tsx
  resolved-market-card.tsx

src/components/feed/
  activity-feed.tsx                         — Throttled: max 1 update/sec, slide-in 200ms
  activity-item.tsx

src/components/layout/
  bottom-nav.tsx                            — Markets, Portfolio, Wallet, Profile
  top-nav.tsx
  balance-chip.tsx                          — Satoshi Bold 700, tick animation

src/components/ui/
  odometer.tsx, confetti.tsx, swipe-to-confirm.tsx

src/hooks/
  use-market.ts, use-markets.ts, use-place-bet.ts, use-activity-feed.ts

src/lib/market-utils.ts                     — calculateLockedRatio, calculateDynamicMaxBet, getMarketTimeState
```

**Interaction states:**
```
Markets list  | Skeleton cards (pulsing) | "No active markets." + notify bell | "Couldn't load." + retry | Fade-up staggered
Bet placement | "Placing..." spinner     | N/A                                | "Bet failed: [reason]"   | Confetti
Activity feed | Skeleton lines           | Simulated (48hr cold start)        | Silent fail              | Slide-in
```

---

## Stream 4: Wallet + Payments

**Files:**
```
src/app/(app)/wallet/page.tsx               — Balance (Satoshi Black 48px), deposit/withdraw, tx history
src/app/(app)/wallet/deposit/page.tsx       — Presets, USDT/USDC, 3pay widget, waiting state
src/app/(app)/wallet/withdraw/page.tsx      — Amount, fee breakdown, destination, confirm

src/app/api/webhook/3pay/route.ts           — HMAC verification, idempotency, calls process_deposit

src/components/wallet/
  balance-display.tsx, transaction-list.tsx, transaction-item.tsx,
  deposit-form.tsx, withdrawal-form.tsx, deposit-status.tsx,
  deposit-bonus-banner.tsx                  — "Deposit $20+ and get $5 free!"
                                              (ONLY shown to non-referred users)

src/hooks/use-balance.ts, use-transactions.ts, use-deposit.ts, use-withdrawal.ts

src/lib/3pay/client.ts, webhook.ts
src/lib/fee-calculator.ts
```

**Bonus rule:** $5 free only for non-referred users, first deposit $20+.

---

## Stream 5: Admin Dashboard

**Files:**
```
src/app/admin/
  layout.tsx                                — Sidebar, admin guard
  page.tsx                                  — Treasury overview
  markets/page.tsx                          — Pool ratios (color-coded)
  markets/create/page.tsx                   — EN/AR question, dates, seed amounts (>0 required)
  markets/[id]/page.tsx                     — Detail: resolve, lock, void, view bets
  markets/[id]/resolve/page.tsx             — TWO-STEP: outcome → payout preview → red "FINAL" → confirm
  withdrawals/page.tsx                      — Queue: approve/reject with notes
  users/page.tsx                            — Search, freeze/unfreeze
  users/[id]/page.tsx                       — Balance, history, manual adjust, referral chain view
  fees/page.tsx                             — All fee config (platform %, deposit %, withdrawal,
                                              commission rates per level per depth)
  agents/page.tsx                           — Agent list: level, direct refs, Tier 1/2/3 earnings
  alerts/page.tsx                           — Lopsided markets, large bets, multi-account,
                                              dead markets, BOTH-SIDE BETTING detection

src/components/admin/ (standard shadcn/ui tables/forms)
src/hooks/admin/ (treasury, markets, withdrawals, users, fees, alerts)
```

---

## Stream 6: Social + Growth

**Files:**
```
src/app/(app)/
  portfolio/page.tsx                        — Active bets (individual cards, even if both sides),
                                              historical, stats bar (win rate, P&L, accuracy)
  leaderboard/page.tsx                      — Accuracy (excludes both-side markets), profit, weekly
  referral/page.tsx                         — Link (copy + WhatsApp), ref count, commission earned,
                                              level progress bar, Tier 1/2/3 earnings breakdown
  referral/agent/page.tsx                   — Full agent dashboard (visible at 10+ refs):
                                              referral tree visualization (3 levels),
                                              volume by tier, commission by depth, payout history
  notifications/page.tsx

src/app/api/og/[marketId]/route.tsx         — Dynamic OG image

src/components/portfolio/, leaderboard/, referral/, notifications/
src/hooks/use-portfolio.ts, use-leaderboard.ts, use-referrals.ts, use-notifications.ts
src/lib/og/market-card.tsx, notifications/push.ts, share.ts
```

---

## Integration Contracts

| Producer | Consumer | Contract | During Parallel Dev |
|----------|----------|----------|-------------------|
| Stream 0 | All | `src/types/database.ts` | Manually written; regenerate after Stream 1 |
| Stream 1 | 3, 4, 5 | `supabase.rpc()` functions | Hooks handle errors; mock responses |
| Stream 1 | All | RLS policies | Use service role during dev |
| Stream 2 | 3, 4, 6 | `useUser()` hook | Returns null if not authed |
| Stream 2 | 1 | Referral chain setup | On signup: build referral_chain, trigger level update |

---

## Execution Plan

| Day | Work |
|-----|------|
| Day 1 | Stream 0 (foundation) — single agent |
| Days 2-5 | Streams 1-6 in parallel — 6 agents |
| Days 6-7 | Integration: wire RPCs, fix types, E2E tests |
| Day 8 | Polish: animations, RTL, error/loading states |

**Critical path:** Stream 1. Prioritize: tables → place_bet → resolve_market (+ sub-functions + settle_commissions) → commission tests.

---

## Verification

1. **Unit tests:** Stream 1 tests against local Supabase (`supabase start`)
2. **Commission tests:** Multi-level chain, all level combos, net-exposure cap, voided markets
3. **Component tests:** Bet panel, fee calculator, payout display
4. **E2E critical path:** Signup → deposit → bet → resolve → payout → withdrawal
5. **E2E agent path:** Referral signup → bet → resolve → Tier 1 commission credited
6. **E2E multi-level:** A→B→C→D chain → D bets → C/B/A all earn correct tiers
7. **E2E both-side:** Bet YES+NO → resolve → net-exposure commission = correct → admin alert
8. **Property-based:** Zero-sum, scaling, fee = 7%, commission ≤ 3.05% combined
9. **Manual:** RTL, responsive, animations, swipe-to-confirm
