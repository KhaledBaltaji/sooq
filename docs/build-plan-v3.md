# V3 Migration Plan: Pool-Based → LMSR AMM (Full Migration)

## Implementation Status (as of 2026-04-06)

| Feature | Status | Notes |
|---|---|---|
| LMSR AMM engine | ✅ Complete | `execute_trade`, LMSR math, buy/sell, fees |
| Trading UI | ✅ Complete | Price display, trade panel, position cards, cash-out |
| Price charts | ✅ Complete | `get_price_history` with 6 period buckets, Recharts |
| Resolution + void | ✅ Complete | PIN-protected, notifications, commission settlement |
| Deposits + withdrawals | ✅ Complete | `process_deposit`/`process_withdrawal`, idempotent |
| Commission system (NGR) | ✅ Complete | 3-layer, 4-tier, activation gate (5 referrals) |
| Agent wallet | ✅ Complete | Separate wallet, transfer to portfolio |
| Admin panel | ✅ Complete | Dashboard, markets, users, fees, finance, AMM, stats, logs, alerts, help CMS, support |
| Support system (AI) | ✅ Complete | Anthropic AI agent, OTP verification, Telegram channel |
| Telegram bot | ✅ Complete | Account linking, support routing, admin forwarding |
| Monitoring | ✅ Complete | Sentry, Slack alerts, cron error checks, health endpoint |
| Pre-launch system | ✅ Complete | Waitlist, prediction voting, referral tracking |
| Geo tracking | ❌ Removed (mig 348) | Vercel IP geo unreliable in Lebanon |
| Leaderboard | ⏳ Backend only | `leader_stats` table updated, no frontend UI |
| Market comments | ⏳ Backend only | Tables + realtime enabled, no UI component |
| Price alerts (creation) | ⏳ Backend only | Alerts trigger notifications, no UI to create them |
| Copy trading | ⏳ Tables only | `copy_settings` + `leader_stats` created, no RPC or UI |
| Payment integration (3pay) | 🔜 Pending | Webhook route exists, needs merchant credentials |
| Payment integration (Whish) | 🔜 Pending | Webhook route exists, needs developer account |
| Limit orders | ❌ Deferred | Deferred per eng review (GTC vs FOK design confusion) |

---

## Context

The prediction market uses a pool-based (parimutuel) model where payout ratios are locked at bet time and users can't exit until resolution. V3 replaces this with an LMSR Automated Market Maker — users buy/sell shares at real-time prices and cash out anytime. This is a complete core model replacement.

**Pre-launch status:** No real users. Full migration (drop pool tables, replace with AMM). No version-column coexistence needed.

**What stays the same:** Auth (phone OTP + email), 3pay payments, Supabase architecture, append-only ledger, dark mode/RTL/mobile-first, notifications, deposit bonus, referral chain mechanics.

**CEO Review Decisions:**
- Full migration (drop `bets`, create `trades` from scratch)
- Selective expansion: +Price Alerts, +Portfolio P&L Dashboard, +Whish Integration
- Limit orders DEFERRED (Codex found design confusion — GTC vs FOK)
- Basic sparkline chart (not full candlestick)
- Copy trading tables now, UI deferred to week 3-4

**Eng Review Decisions (Codex outside voice):**
- Limit orders deferred to post-launch (reduces scope ~20%)
- Full trading allowed until resolution (buys + sells, no freeze window)
- Only buys count toward wagering requirement (prevents churn exploit)
- Deposits table: rename `threepay_ref` → `provider_ref`, add `provider` column
- Show both 3pay + Whish to all users (no country gating)
- Agent level thresholds updated to V3: 0-9, 10-49, 50-199, 200+
- Commission model: update `docs/commission-model.md` to V3 (0.5% explicit fee basis)
- Leaderboard accuracy = based on final net position at resolution (positive P&L = correct prediction)

---

## Phase 1: Database — Drop V2, Create V3 Schema

### Step 1A: Drop V2 Pool Tables & Functions
Single migration that drops everything pool-related:
- Drop functions: `place_bet`, `calculate_payouts`, `distribute_payouts`, `settle_commissions`, `record_revenue`, `void_market`, `_void_market_internal`, `dead_market_check`, `dynamic_max_bet`
- Drop table: `bets`
- Drop columns from `markets`: `pool_yes`, `pool_no`, `seed_amount_yes`, `seed_amount_no`
- Drop materialized view: `leaderboard_stats`
- Drop realtime on `bets`

**Files to delete/replace:**
- `supabase/migrations/003_bets.sql` → replaced by trades
- `supabase/migrations/020_fn_place_bet.sql` → replaced by execute_trade
- `supabase/migrations/021_fn_resolve_market.sql` → rewritten
- `supabase/migrations/029_fn_dynamic_max_bet.sql` → replaced
- `supabase/migrations/030_fn_dead_market_check.sql` → rewritten for AMM
- `supabase/migrations/034_fn_void_market_internal.sql` → rewritten
- `supabase/migrations/027_fn_void_market.sql` → rewritten
- `supabase/migrations/060_fn_calculate_payouts.sql` → deleted (AMM handles this)
- `supabase/migrations/061_fn_distribute_payouts.sql` → deleted
- `supabase/migrations/062_fn_settle_commissions.sql` → rewritten for V3 fee basis
- `supabase/migrations/063_fn_record_revenue.sql` → rewritten for 5-layer tracking
- `supabase/migrations/052_leaderboard_view.sql` → rewritten

### Step 1B: New Enums & Tables

**New enum:** `trade_direction` = `'buy' | 'sell'`
**Extended enum:** `transaction_type` += `'trade'`, `'cash_out'`, `'resolution_fee'`

**New tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `amm_state` | Per-market AMM state | `market_id` (UNIQUE), `liquidity_param`, `q_yes`, `q_no`, `current_yes_price`, `current_no_price`, `total_volume`, `total_trades`, `seed_pnl` |
| `trades` | All buy/sell transactions | `user_id`, `market_id`, `side`, `direction`, `shares`, `price_per_share`, `total_cost`, `explicit_fee`, `amm_spread_cost`, `cash_out_premium`, `is_copy_trade`, `copied_from_user` |
| `positions` | User holdings per market | `user_id`, `market_id`, `side`, `shares_held`, `avg_entry_price`, `total_invested`, `realized_pnl`. UNIQUE(user_id, market_id, side) |
| `price_alerts` | Price threshold notifications | `user_id`, `market_id`, `side`, `target_price`, `direction` (above/below), `is_triggered`, `is_active` |
| `copy_settings` | Copy trading config | `copier_id`, `leader_id`, `amount_per_trade`, `max_per_market`, `max_total`, `is_active` |
| `leader_stats` | Leader performance | `user_id`, `total_trades`, `winning_trades`, `accuracy_pct`, `total_pnl`, `copier_count` |

**Modified tables:**

| Table | Changes |
|-------|---------|
| `markets` | Remove pool columns. Add `amm_liquidity_param DECIMAL(18,6) DEFAULT 1000`. |
| `deposits` | Rename `threepay_ref` → `provider_ref`. Add `provider TEXT NOT NULL DEFAULT '3pay'`. |
| `referral_commissions` | Replace `bet_id` with `trade_id`. Replace `net_exposure` with `explicit_fee_amount`. Replace `depth` with `layer` (1-3). Keep `agent_level_at_time`. |
| `platform_revenue` | Add: `explicit_fee_revenue`, `amm_spread_revenue`, `resolution_fee_revenue`, `dynamic_spread_revenue`, `cash_out_premium_revenue` |
| `fee_config` | Replace V2 entries with V3: `explicit_fee` 0.5%, `resolution_fee` 1%, `cash_out_premium` 0.5%, AMM params. New `v3_commission` rates (4 tiers × 3 layers). |

**RLS policies** for all new tables (same patterns as `supabase/migrations/040_rls_policies.sql`).
**Realtime** on `amm_state`, `trades`, `positions`.

---

## Phase 2: RPC Functions — AMM Engine

### LMSR Math (internal, SECURITY DEFINER)

| Function | Formula | Notes |
|----------|---------|-------|
| `lmsr_cost(b, q_yes, q_no)` | `b * ln(e^(q_yes/b) + e^(q_no/b))` | Log-sum-exp trick: `b * (max_q/b + ln(1 + e^(-abs(q_yes-q_no)/b)))`. Hard cap: reject if any q > 50*b |
| `lmsr_price(b, q_yes, q_no, side)` | `1 / (1 + e^((q_other - q_side)/b))` | Sigmoid form. Always returns (0, 1) |
| `lmsr_shares_for_cost(b, q_yes, q_no, side, cost)` | Closed-form inverse | `shares = b * ln(e^(c/b) * (e^(q_yes/b) + e^(q_no/b)) - e^(q_no/b)) - q_yes` (for YES) |
| `initialize_amm(market_id, liquidity_param)` | Inserts amm_state row | q_yes=0, q_no=0, prices=0.50/0.50 |

### Core Trading

**`execute_trade(p_market_id, p_side, p_direction, p_amount)`** — Replaces `place_bet`
- Pattern from `supabase/migrations/020_fn_place_bet.sql`: `auth.uid()`, `SELECT FOR UPDATE` on user + market + amm_state
- **Buy flow:** LMSR cost calc → 0.5% explicit fee → check dynamic spread (if imbalance >65/35, multiply spread by 1.5) → max trade check (5% of liquidity_param) → debit balance → update amm_state (q, prices, volume, trades) → UPSERT position → insert trade → insert transaction → update total_wagered (buys only) → update markets.bet_count/unique_bettors → update leader_stats → **check price_alerts** (any alerts crossed?)
- **Market lifecycle:** Buys AND sells allowed while market status is 'open'. Full trading until resolution. `lock_market` sets status='closed' for admin emergency stop only.
- **Sell flow:** validate shares_held ≥ requested → LMSR sell proceeds → 0.5% fee + 0.5% cash_out_premium → credit balance → update amm_state → update position (reduce shares, update realized_pnl) → insert trade → insert transaction
- Rate limit: 30 seconds. Returns: `{trade_id, shares, price_per_share, total_cost, fee, new_yes_price, new_no_price, price_impact_warning}`

**`get_amm_price(p_market_id)`** — Returns `{yes_price, no_price, volume, trades}`

**`get_cash_out_value(p_market_id, p_side, p_shares)`** — Sell preview: LMSR proceeds - fees

### Resolution & Settlement

**`resolve_market(p_market_id, p_outcome)`** — Rewritten (no version routing):
1. Lock market + amm_state
2. For each position: winning side gets `shares_held * $0.99` (1% resolution fee), losing side gets $0
4. Call `settle_commissions(p_market_id)` — on explicit fees from trades table
5. Call `record_revenue(p_market_id, total_commissions)` — 5-layer breakdown
6. Calculate seed P&L: `total_collected_by_AMM - total_paid_by_AMM`
7. Update market status, refresh leaderboard

**`settle_commissions(p_market_id)`** — Rewritten:
- Iterate traders on this market, sum their `explicit_fee` from trades
- Walk `referral_chain` max 3 layers deep
- Rate lookup: `fee_type = 'v3_commission'`, keyed by agent_level and depth
- Rate is % of explicit fee (e.g., 0.20 = 20% of the 0.5%)
- Commission = sum_explicit_fees × rate

**`record_revenue(p_market_id, total_commissions)`** — Rewritten:
- Track all 5 layers: explicit fees, AMM spread, resolution fees, dynamic spread, cash_out premium
- Net revenue = total fees - commissions

**`void_market(p_market_id)`** — Rewritten:
- Refund all positions (credit total_invested - realized_pnl)
- Claw back any credited commissions
- Update market status

**`dead_market_check()`** — Updated for AMM (void markets with <$100 volume after 48 hours)

**`reconcile_balances()`** — No changes needed (sums all transactions regardless of type)

### Commission Rate Table (V3)

| Layer | Tier 1 (0-9 refs) | Tier 2 (10-49) | Tier 3 (50-199) | Tier 4 (200+) |
|-------|-------------------|----------------|-----------------|---------------|
| Layer 1 (direct) | 20% of 0.5% | 25% of 0.5% | 30% of 0.5% | 35% of 0.5% |
| Layer 2 | 10% of 0.5% (all) | | | |
| Layer 3 | 5% of 0.5% (all) | | | |

Note: Commission on explicit fee only. Hidden spread is 100% platform revenue.

---

## Phase 3: Frontend Changes

### 3A: Types (`src/types/`)
- `database.ts` — Replace bets types with trades/positions/amm_state. Remove pool columns from Market type. Add limit_orders, price_alerts types. Add new RPC signatures.
- `market.ts` — Replace `Bet`, `PlaceBetResult` with `Trade`, `Position`, `AmmState`, `ExecuteTradeResult`, `CashOutValueResult`, `LimitOrder`, `PriceAlert`

### 3B: Hooks (`src/hooks/`)

**New:**
| Hook | Purpose |
|------|---------|
| `use-execute-trade.ts` | Calls `execute_trade` RPC (pattern from `use-place-bet.ts`) |
| `use-position.ts` | Fetch + realtime subscribe user position for one market |
| `use-positions.ts` | Fetch all user positions (portfolio) with aggregate P&L |
| `use-amm-price.ts` | Realtime subscribe to `amm_state` for live prices |
| `use-cash-out.ts` | Preview + execute sell |
| `use-price-alerts.ts` | CRUD for price alerts |

**Modified:**
- `use-market.ts` — fetch `amm_state` alongside market
- `use-markets.ts` — fetch amm prices for market cards

**Deleted:**
- `use-place-bet.ts` — replaced by use-execute-trade

### 3C: Components (`src/components/market/`)

**New:**
| Component | Replaces | Purpose |
|-----------|----------|---------|
| `price-display.tsx` | `pool-bar.tsx` | YES $0.62 / NO $0.38 with animated transitions |
| `price-chart.tsx` | — | Basic sparkline from trade history (Recharts) |
| `trade-panel.tsx` | `bet-panel.tsx` | Buy flow: shares @ price, 0.5% fee, swipe confirm. Pattern from `src/components/market/bet-panel.tsx` |
| `position-card.tsx` | — | Shares, entry price, current price, P&L (green/red), "Cash out" button |
| `cash-out-sheet.tsx` | — | Bottom sheet: sell confirmation with fee breakdown |
| `price-alert-button.tsx` | — | Bell icon to set price alerts on position card |

**Deleted:**
- `pool-bar.tsx` — replaced by price-display
- `bet-panel.tsx` — replaced by trade-panel

**Modified:**
- `market-card.tsx` — show price instead of pool bar, volume instead of pool size
- `activity-feed.tsx` — subscribe to `trades` table instead of `bets`

### 3D: Pages

| Page | Changes |
|------|---------|
| `market/[id]/page.tsx` | Replace PoolBar+BetPanel with PriceDisplay+PriceChart+TradePanel+PositionCard. |
| `portfolio/page.tsx` | **Rewrite:** Portfolio P&L dashboard (total invested, unrealized P&L, realized P&L, win rate) + position cards with cash-out |
| `(app)/page.tsx` | Minor: MarketCard now shows price not pool |
| `admin/markets/create/page.tsx` | Replace seed amounts with AMM liquidity param field |
| `admin/markets/[id]/page.tsx` | Show AMM state: prices, q values, imbalance ratio, spread width, seed P&L |
| `admin/markets/[id]/resolve/page.tsx` | Show AMM prices instead of pool breakdown |
| `referral/page.tsx` | Update copy: "0.5% trading fee" basis |
| `wallet/deposit/page.tsx` | Add Whish deposit option alongside 3pay |

**New pages:**
- `admin/amm/page.tsx` — AMM Risk Dashboard: total seed capital, aggregate P&L, per-market imbalance, 5-layer revenue breakdown

### 3E: Utilities
- `src/lib/market-utils.ts` — Replace pool functions with AMM functions: `getAmmPrice()`, `calculateSharesForAmount()`, `calculateCashOutValue()` (client-side LMSR preview for instant UI feedback)
- `src/lib/constants.ts` — Replace `BET_PRESETS` with `TRADE_PRESETS`, `MIN_TRADE`, `TRADE_RATE_LIMIT_SECONDS`, `MAX_TRADE_PCT_OF_LIQUIDITY`

---

## Phase 4: Whish Payment Integration

### Webhook Handler
- New file: `src/app/api/webhook/whish/route.ts` — pattern from `src/app/api/webhook/3pay/route.ts`
- HMAC signature verification (same pattern as 3pay)
- Calls `process_deposit` RPC (already handles multiple currencies)
- Idempotent on whish transaction reference

### Deposit UI
- Add Whish tab/option to `src/app/(app)/wallet/deposit/page.tsx`
- Show Whish for Lebanese users, 3pay for all users
- Unified USD balance (both deposit methods → same balance)

### Environment
- Add `WHISH_WEBHOOK_SECRET` to `.env.local.example`
- Add `WHISH_API_KEY` if needed for initiating payments

---

## Phase 5: Polish & Deferred Features

### Shareable Market Cards (week 2-3)
- Update `/api/og/[marketId]/route.tsx` for AMM prices
- Three card types: market, position, win

### Copy Trading (week 3-4)
- Tables already created in Phase 1
- `execute_copy_trade` RPC + trigger on trades
- Leader commission: 10% of copier net profit

### Seed Script
- Rewrite `scripts/seed-dev.ts` for V3: create markets with AMM state, sample trades + positions

---

## Execution Order

```
Week 1 (CC: ~2-3 hours):
  Stream 1: Phase 1 (drop V2, create V3 schema — all migrations)
  Stream 2: Phase 2 (LMSR math → execute_trade → resolution)
  Stream 3: Phase 3A-B (types + hooks, can start after Phase 1)

Week 2 (CC: ~2-3 hours):
  Stream 4: Phase 3C-E (components + pages + utilities)
  Stream 5: Phase 4 (Whish integration)
  Stream 6: Price alerts (DB + RPC + UI)

Week 3 (CC: ~1-2 hours):
  Testing, seed data, QA
  Phase 5 (location, OG cards, copy trading tables)
```

---

## Verification Plan

1. **LMSR Math:** Unit tests for cost/price/inverse. Prices always sum to ~1.0. Numerical stability at extreme q values (q > 10*b).
2. **execute_trade:** Buy/sell end-to-end. Balance, position, amm_state, transaction ledger all correct. Rate limit, max trade size, frozen account.
3. **Price alerts:** Set alert, trade to cross threshold, verify notification created.
4. **Resolution:** Winners get shares × $0.99. Losers get $0. Commission on explicit fees. 5-layer revenue.
5. **Void:** All positions refunded. Commissions clawed back.
7. **Ledger integrity:** `reconcile_balances()` passes after trades + resolution + void.
8. **Whish:** Webhook signature verification. Idempotent deposit. Balance credited.
9. **Portfolio P&L:** Aggregate unrealized/realized P&L matches sum of individual positions.
10. **Frontend:** Market detail shows prices, trade flow works, position updates real-time, cash out works.
11. **Admin:** Create market with AMM, see state, resolve/void, risk dashboard.

---

## Key Risk Mitigations

- **LMSR overflow:** Log-sum-exp trick + hard cap on q values (reject trade if q > 50*b). `DECIMAL(18,6)` throughout.
- **Race conditions:** `SELECT FOR UPDATE` on user + market + amm_state serializes trades per market.
- **Limit order cascades:** Fill-or-kill prevents partial fills. Check and execute one order at a time within the same transaction.
- **Rollback:** Pre-launch — git revert + Supabase DB reset. No user data at risk.
- **Whish integration risk:** If Whish API unavailable, 3pay still works as primary. Whish is additive.

---

## Critical Files Reference

| Purpose | File |
|---------|------|
| `place_bet` pattern (auth, locking, ledger) | `supabase/migrations/020_fn_place_bet.sql` |
| `settle_commissions` pattern | `supabase/migrations/062_fn_settle_commissions.sql` |
| `3pay webhook` pattern (for Whish) | `src/app/api/webhook/3pay/route.ts` |
| `BetPanel` UI patterns (for TradePanel) | `src/components/market/bet-panel.tsx` |
| Market detail page (largest change) | `src/app/(app)/market/[id]/page.tsx` |
| Database types (central update) | `src/types/database.ts` |
| Market types | `src/types/market.ts` |
| Fee config seed data | `supabase/migrations/009_fee_config.sql` |
| RLS policies pattern | `supabase/migrations/040_rls_policies.sql` |
| Commission model spec | `docs/commission-model.md` |
| Design system | `DESIGN.md` |

---

## Design Specs (from /plan-design-review)

### Market Detail Page Hierarchy
1. **Question** (Satoshi Bold xl) — always first
2. **Prices** (Satoshi Black 2xl) — YES in `--yes` blue, NO in `--no` amber. Inline row, not card.
3. **Sparkline** — basic price history, minimal chrome
4. **Stats row** — volume, traders, countdown (DM Sans sm muted)
5. **Position card** (if user has position) — shares, avg price, current price, P&L with Odometer, "Cash out" full-width button
6. **Trade panel** — YES/NO toggle, presets, share preview, fee, swipe-to-confirm
7. **Activity feed** — recent trades

### V3 Interaction States
| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| Trade (buy) | "Buying..." spinner | N/A | "Trade failed: [reason]" toast | Confetti + position card appears | N/A |
| Trade (sell) | "Selling..." spinner | N/A | "Sale failed: [reason]" toast | Profit: celebration / Loss: soft screen | N/A |
| Position card | Skeleton card | Hidden (show TradePanel) | "Couldn't load position" | Live P&L with Odometer | N/A |
| Price display | Skeleton numbers | $0.50 / $0.50 | "Price unavailable" | Live Odometer ticks | N/A |
| Portfolio P&L | Skeleton + shimmer | "Make your first trade" + trending markets | "Couldn't load portfolio" | Aggregate P&L + position cards | N/A |
| Price alert | Inline spinner | Bell icon on position card | "Alert failed" toast | "Alert set!" toast | N/A |
| Whish deposit | "Connecting to Whish" | N/A | "Whish unavailable" | "Deposited! Balance: $X" | "Pending" |

### Cash-Out Experience
- **Profit:** Confetti + big green number "$4.89 profit!" + share button ("Can you beat me?") + referral link
- **Loss:** Soft screen — "You received $22.37" (focus on what they got, not loss). Below: "Trending now" with suggested market. No red, no sad messaging.

### V3 Motion Specs (update DESIGN.md)
- Price tick: Odometer (400ms) when AMM price changes from any trade
- P&L update: color transition + number tick (300ms)
- Cash-out sheet: slide up from bottom (250ms ease-out)
- Profit celebration: confetti (existing 600ms) + number scale-up entrance (400ms)
- Position card entrance: fade-in (200ms) after first trade
- Price chart: point addition animation (150ms ease-out)

### Responsive Notes
- Cash-out: bottom Sheet on mobile, Dialog on desktop
- Price display: 2xl (32px) numbers work at 375px width
- P&L: ▲/▼ arrows alongside green/red (a11y — color alone insufficient)
- All new buttons: 48px height minimum (exceeds 44px a11y requirement)

---

## NOT in Scope

- **Limit orders** (deferred per eng review — design needs GTC vs FOK clarification)
- Full candlestick/area chart with time intervals (basic sparkline ships)
- Order book alongside AMM (Month 2+)
- Stop loss / take profit (Month 2+)
- API access for bots (Month 2+)
- Auto-approve small withdrawals (Month 2+)
- Egypt expansion + Vodafone Cash (Month 2+)
- PWA manifest (Month 2+)
- Dynamic spread widening on close (can add post-launch)
- "People viewing" WebSocket counter (can add post-launch)

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 5 proposals, 4 accepted, 1 skipped |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES_FOUND | 10 findings, 7 addressed in eng review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 7 issues resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 5/10 → 9/10, 8 decisions |

- **CODEX:** Found limit order design confusion (FOK vs GTC), ledger hold gap, wagering loophole, Whish sequencing bug, lifecycle gap. All addressed.
- **CROSS-MODEL:** Codex recommended deferring limit orders; eng review agreed. Codex recommended smaller scope; partially adopted (limit orders deferred, rest kept).
- **UNRESOLVED:** 0
- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement.
