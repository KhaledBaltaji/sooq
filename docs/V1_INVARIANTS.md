# V1 System Invariants

> Non-negotiable rules. No future work — including V2, branch architecture, or any new feature — is allowed to break these. If a proposed change violates any invariant listed here, the change must be redesigned.

---

## Non-Negotiable Invariants

### INV-1: One locked `amm_state` row per market serializes all trades

Every trade on a market must acquire `SELECT * FROM amm_state WHERE market_id = X FOR UPDATE` before reading or writing q values. This guarantees that two trades on the same market cannot execute concurrently.

**Why:** The LMSR cost function is stateful. `lmsr_shares_for_cost(b, q_yes, q_no, side, cost)` returns a different number of shares depending on the current q values. If two trades read the same q values simultaneously, both get priced at the same level — the AMM issues more shares than the math supports and SOOQ loses money.

**Where:** `execute_trade()` line 71 (migration 177)

**Rule:** Any new code path that moves q values or reads prices for execution purposes MUST lock `amm_state FOR UPDATE` first.

---

### INV-2: User row locked (`FOR UPDATE`) before any balance mutation

Every function that modifies `balance_usd` or `agent_balance_usd` must first acquire `SELECT * FROM users WHERE id = X FOR UPDATE`.

**Why:** Without this, concurrent operations (trade + deposit, two trades on different markets, commission credit + withdrawal) can read stale balances and produce incorrect `balance_after` values or overdraft the account.

**Where:** `execute_trade()` line 62, `resolve_market()` payout loop, `_void_market_internal()` refund loop, `process_deposit()`, `process_withdrawal()`, `_credit_commission()`

**Rule:** Any new function that touches user balances MUST lock the user row first. No exceptions.

---

### INV-3: Append-only `transactions` table is the source of truth for all balances

The `transactions` table accepts INSERT only — no UPDATE, no DELETE. `users.balance_usd` is a cache. The authoritative balance is `SUM(amount) FROM transactions WHERE user_id = X`.

**Why:** This is the audit trail. If a bug or race condition causes `balance_usd` to drift, the ledger allows reconstruction. Allowing mutations to the ledger destroys this safety net.

**Where:** `transactions` table (migration 004), verified by `reconcile_balances()` via `/api/cron/check-errors`

**Rule:** Never UPDATE or DELETE rows in `transactions`. Never bypass the ledger when mutating balances. Every `UPDATE users SET balance_usd` must have a corresponding `INSERT INTO transactions` in the same database transaction.

---

### INV-4: Commissions calculated on platform revenue, not raw trade amount

Commission = `(explicit_fee + amm_spread_cost + cash_out_premium) × tier_rate`. The raw `p_trade_amount` is used only for `network_volume` tier advancement — never for commission dollar calculation.

**Why:** If commission were based on trade amount, agents could churn volume (rapid buy-sell cycles) with near-zero net cost but high commission generation. Basing it on actual platform revenue means SOOQ only pays out a share of money it earned.

**Where:** `pay_trade_commissions()` lines 30-39 (migration 184), `_credit_commission()` (migration 169)

**Rule:** Any new commission path must calculate commission from platform revenue fields on the `trades` row, not from the gross trade amount.

---

### INV-5: Retail price movement and SOOQ liability creation are coupled

Every share issued by the AMM is a SOOQ obligation. When a user buys YES shares, SOOQ is committed to paying $0.99 per share if YES wins. The price movement (q_yes increasing) and the liability creation (position row inserted) happen in the same transaction.

**Why:** Decoupling these — e.g., moving the price without creating a position, or creating a position without moving the price — would break the AMM's economic model. The price IS the market's estimate of probability, and it's only accurate if every share issued is backed by real money.

**Where:** `execute_trade()` — AMM update (line 136-141) and position UPSERT (line 143-148) are in the same function and same transaction.

**Rule:** Any new code path that moves AMM q values MUST account for who holds the resulting shares and who bears the payout obligation.

---

### INV-6: LMSR math functions are pure, reusable core primitives

`lmsr_cost`, `lmsr_price`, `lmsr_shares_for_cost` are `IMMUTABLE` functions with no table access and no side effects. They take `(b, q_yes, q_no, ...)` and return a number.

**Why:** These are the mathematical foundation. Their correctness has been verified by 56 tests and months of staging use. They must never acquire state dependencies, table reads, or side effects.

**Where:** Migration 107

**Rule:** Never modify these functions to read from tables, write state, or depend on anything beyond their input parameters. Any caller that can provide `(b, q_yes, q_no)` can use them.

---

## Reusable V1 Modules — Keep and Build Around

### MOD-1: LMSR Math Functions

`lmsr_cost(b, q_yes, q_no)`, `lmsr_price(b, q_yes, q_no, side)`, `lmsr_shares_for_cost(b, q_yes, q_no, side, cost)`

Numerically stable (log-sum-exp trick), overflow-protected (50×b hard cap), pure/IMMUTABLE. Any new trade execution path (branch, hedge, simulation) should call these directly.

**Source:** `supabase/migrations/107_v3_fn_lmsr_math.sql`

---

### MOD-2: `fee_config` Pattern

Extensible key-value rate storage with `(fee_type, level, depth)` composite key. Global rates use `level IS NULL`. Tiered rates use `level = agent_level, depth = layer`. Adding new fee types requires only INSERT — no schema changes.

**Source:** `supabase/migrations/009_fee_config.sql`, seeded in 103, 129, 165

**Extension pattern:** Insert rows like `('branch_hedge_fee', 1, NULL, 0.003, 'description')` and read with `SELECT rate FROM fee_config WHERE fee_type = 'branch_hedge_fee' AND level = X`.

---

### MOD-3: Append-Only Ledger + `balance_after` Snapshot + Reconciliation Cron

Pattern: every balance mutation does `UPDATE balance → INSERT transaction(amount, balance_after)`. The `reconcile_balances()` function checks `SUM(transactions.amount) = users.balance_usd` and alerts on drift > $0.001.

**Source:** `transactions` table (migration 004), reconciliation in `/api/cron/check-errors`

**Extension pattern:** Any new financial entity (branch collateral, branch ledger) should replicate this exact pattern with its own transactions table and reconciliation check.

---

### MOD-4: Webhook Auth Pattern (HMAC-SHA256 + Idempotency Key)

Verify `HMAC-SHA256(body, secret)` against signature header. Reject duplicates via unique `provider_ref` column on deposits table. Use service-role Supabase client to bypass RLS.

**Source:** `src/app/api/webhook/3pay/route.ts`, `src/app/api/webhook/whish/route.ts`

**Extension pattern:** Any new webhook (branch callbacks, new payment provider) should follow this exact structure.

---

### MOD-5: Protected-Column Trigger Pattern

`trg_protect_sensitive_user_columns` blocks direct UPDATE on sensitive fields (`balance_usd`, `agent_balance_usd`, `referral_chain`, `agent_level`, etc.). SECURITY DEFINER functions bypass with `set_config('app.trigger_bypass', 'true', true)`.

**Source:** `supabase/migrations/041_protect_sensitive_columns.sql`

**Extension pattern:** If a new table has fields that should only be modified by RPCs (e.g., branch collateral), apply the same trigger pattern.
