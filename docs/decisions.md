# Decision Log

Architectural and product decisions made during development. Each entry records what was decided, why, and when.

---

## V1 Launch Decisions (Locked)

> These are final for V1 launch. Revisit only with new data post-launch.

### 2026-04-05: Retail Max Trade Rule — Liquidity-Based

**Decision:** Max trade = `GREATEST(b × amm_max_trade_pct, $100)`. With `b=1000` and `amm_max_trade_pct=0.05`, this yields `GREATEST($50, $100) = $100`.

**Old rule:** `total_volume × max_trade_pct + $100` — grew linearly with volume, no upper bound tied to AMM capacity.

**Why changed:** The AMM's price sensitivity is determined by `b`. A single trade larger than ~5% of `b` can move the price >5 percentage points, creating exploitable slippage. Tying max trade to `b` ensures no single trade can dominate the price curve.

**Floor of $100:** Ensures usability on all markets. On `b=1000`, the floor is the binding constraint. On larger `b` (e.g., `b=5000`), the percentage takes over at $250.

**Tuning:** Change `amm_max_trade_pct` in `fee_config`. No code change needed.

**Implemented:** Migration 187.

### 2026-04-05: No Per-User Exposure Cap at Launch

**Decision:** Launching without a per-user exposure cap. Users can invest their full balance into a single market or side.

**Why:** At launch scale (2-3K users, 3-5 markets, $100 max trade), blast radius is bounded by the max trade rule. Users need many sequential trades to build large positions, and each trade moves the price further against them (LMSR self-corrects).

**Revisit trigger:** Any single user holds >30% of all shares on a side, or total platform liability on a single market exceeds $10K.

### 2026-04-05: Dynamic Spread Threshold at 5%/95%

**Decision:** Dynamic spread activates when price < 5% or > 95% (`dynamic_spread_threshold=0.05` in `fee_config`). Adds ~0.5% extra spread in extreme-price territory.

**Why:** At extreme prices, a small dollar amount buys many shares (LMSR curve is flat near 0/100%). The extra spread makes cheap accumulation slightly more expensive without affecting normal trading.

**Tuning:** Change `dynamic_spread_threshold` and `dynamic_spread_multiplier` in `fee_config`. No code change needed.

**Implemented:** `execute_trade` (migration 187). Now tracked in separate `dynamic_spread` column on `trades` table.

---

## V1 Accepted Risks (Documented, Not Fixed)

### Risk 1: Void Clawback `balance_after` Bug

**Location:** `_void_market_internal` (migration 157), line ~53.

**Bug:** When clawing back credited commissions, RETURNING returns `balance_usd` (portfolio balance) instead of `agent_balance_usd` (commission wallet). Ledger `balance_after` for clawback transactions records the wrong value.

**Impact:** Cosmetic only. The actual `agent_balance_usd` update is correct. `reconcile_balances()` doesn't check agent balance consistency.

**Why deferred:** Market voiding is rare. Fix requires rewriting high-blast-radius void logic for a cosmetic issue.

### Risk 2: Ancestor Locking Inconsistency in Commission Path

**Location:** `pay_trade_commissions` (migration 184) — no `FOR UPDATE` on ancestors. `settle_resolution_commissions` (migration 131) — does lock with `FOR UPDATE`.

**Bug:** Concurrent trades from same referral chain could race on `agent_balance_usd` update. Balance itself is correct (atomic increment), but commission `balance_after` in ledger could be stale.

**Impact:** Cents-level ledger snapshot inaccuracy on commission transactions. Agent balance is always correct.

**Why deferred:** Commission amounts are small ($0.01-$0.22 typical). Concurrent-chain window is narrow at launch volumes. Will fix when commission path is next modified.

### Risk 3: No Per-User Trade Frequency Limit

**Location:** `execute_trade` (migration 187). The 30-second cooldown was removed in migration 161.

**Impact:** Users could submit rapid trades. However, ~5% round-trip fees make churning self-punishing. Commission is based on platform revenue (INV-4), not volume, so agents cannot benefit from referral churn.

**Why deferred:** Fee structure is the primary anti-churn defense. IP rate limiting (100 req/min) provides backstop. Per-user cooldown would hurt legitimate UX.

---

## 2026-03-31: Fix P0 bugs from codebase audit

**Decision:** Fix 4 runtime bugs + 3 test bugs found during comprehensive audit.
**Why:** `.from("bets")` on dropped table, void ledger corruption, hardcoded withdrawal fee, zombie function overloads, broken race test, broken void test.
**Impact:** Migration 157, 6 file edits. All bugs were silent (no user-facing errors yet) but would cause data corruption or wrong displays in production.

## 2026-03-31: Multi-session safety protocol

**Decision:** Implement file-based lockfile system for concurrent Claude Code sessions.
**Why:** User runs multiple sessions simultaneously on the same branch. Without coordination, sessions create conflicting migrations and overwrite each other's work.
**Impact:** `.claude/sessions/` directory with lockfiles and migration reservation counter. Protocol rules added to CLAUDE.md.

## 2026-03-30: Remove demo environment, simplify to staging → main

**Decision:** Eliminate the `demo` branch and environment. Two environments only: staging (wipeable) and production (sacred).
**Why:** Demo was redundant — staging already serves the same purpose. Three environments added complexity without value.
**Impact:** Deleted deploy-demo.yml, snapshot-demo.yml. Updated CI triggers, pre-push hook, CLAUDE.md.

## 2026-03-30: PIN-protect all admin financial operations

**Decision:** Require 6-digit bcrypt PIN for credit/debit, fee changes. Lockout after 5 failures.
**Why:** Admin panel handles real money. PIN adds a second factor beyond just being logged in as admin.
**Impact:** `admin_adjust_balance`, `admin_update_fee` RPCs with PIN verification. `admin_set_pin`, `admin_has_pin` helper RPCs.

## 2026-03-30: Atomic market creation

**Decision:** Replace two-step market creation (INSERT + initialize_amm) with single `admin_create_market` RPC.
**Why:** If AMM init failed after market INSERT, the market existed without an AMM — broken state.
**Impact:** Migration 154, frontend simplified to single RPC call.

## 2026-03-28: V3 AMM model (LMSR) replaces V2 pool model

**Decision:** Full migration to LMSR automated market maker. No V2 coexistence.
**Why:** Pool model had liquidity issues and couldn't support real-time trading. LMSR provides continuous pricing and instant execution.
**Impact:** Migrations 100-116 (V3 core), all V2 tables/functions dropped.

## 2026-03-26: Network-volume agent levels replace referral-count tiers

**Decision:** Agent levels determined by network trading volume ($10K/$50K/$200K thresholds) instead of direct referral count.
**Why:** Referral count is gameable (fake accounts). Network volume rewards agents whose referrals actually trade.
**Impact:** Migration 133 (update_agent_level_v2). Commission model doc updated.

## 2026-03-26: Agent activation gate (5 qualified referrals)

**Decision:** Agents must have 5 referrals who have each placed at least one trade before commissions are credited. Until then, commissions are escrowed. (Originally 10, reduced to 5 on 2026-04-03 to lower barrier to entry.)
**Why:** Prevents fraud — agents can't claim commissions from fake/inactive referrals.
**Impact:** Migration 150. New columns: agent_activated, agent_activation_override, qualified_referral_count.

## 2026-03-25: Commission on explicit fee only (not net exposure)

**Decision:** Commission is a share of the visible 0.5% trading fee per trade. Hidden AMM spread is 100% platform.
**Why:** V2 commission on net exposure was $0 for hedged positions. Fee-based commission means every trade generates commission regardless of direction.
**Impact:** Migrations 129-131 (NGR commission model). `pay_trade_commissions` at trade time, `settle_resolution_commissions` at resolution.

## 2026-03-24: auth.uid() in all user-facing RPCs

**Decision:** All RPCs that affect user state derive the user from Supabase Auth session, never from client-supplied user_id parameter.
**Why:** Client-supplied user_id is trivially forgeable. Only admin/webhook functions should accept explicit user_id.
**Impact:** All RPCs use `auth.uid()`. Only `process_deposit` (webhook) and admin functions accept p_user_id.

## 2026-03-24: Fee rates from fee_config table, never hardcoded

**Decision:** All fee rates (trading fee, resolution fee, withdrawal fee, commission rates, AMM params) are read from the `fee_config` table at runtime.
**Why:** Allows rate changes without code deployment. PIN-protected admin UI for changing rates.
**Impact:** `fee_config` table with fee_type/level/depth/rate columns. All RPCs read rates dynamically.

## 2026-03-24: Append-only ledger as source of truth

**Decision:** `balance_usd` on users table is a cache. Source of truth is `SUM(transactions)`. All balance mutations go through transactions table.
**Why:** Auditability. If balance_usd drifts, `reconcile_balances` detects and alerts.
**Impact:** `transactions` table with append-only pattern. `balance_after` column for fast reads.
