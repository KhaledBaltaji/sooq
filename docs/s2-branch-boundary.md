# S2 Branch Boundary Specification

> Locked architecture decisions. No code. No implementation details. Boundary rules only.
> Reviewed and approved through iterative review with Claude and ChatGPT.

---

## 1. Core Rule

SOOQ has one canonical price state per market, but two economic execution modes.

**One canonical underlying market price.** Every market has one LMSR producing one probability. There is no secondary price engine, no fair-price oracle, no separate benchmark. Retail users execute at the canonical price. Branch users execute at branch-adjusted quotes derived from the canonical price (canonical + branch markup). The underlying price is the same; the execution quotes differ by access mode.

**Separate liabilities.** Retail trades create SOOQ liability. Branch trades create branch liability. These are economically different events even though they use the same pricing math.

**Shared canonical state.** Both retail and branch trades update the same `q_yes` and `q_no`. This produces the best available ecosystem price — a shared price influenced by both direct market trading and bookmaker-mediated customer flow. Branch flow is real funded conviction but may be partially shaped by branch risk management, pricing policy, and book balancing. This is acknowledged and accepted.

---

## 2. Canonical Market State

Each market has one canonical state:

| Field | Description |
|---|---|
| `market_id` | Unique market identifier |
| `q_yes` | Cumulative YES shares outstanding (all sources) |
| `q_no` | Cumulative NO shares outstanding (all sources) |
| `liquidity_param` | The `b` parameter |
| `current_yes_price` | Cached marginal price (derived from q values) |
| `current_no_price` | Cached marginal price (derived from q values) |

The `q_yes` and `q_no` values reflect ALL trades — retail and branch. The cached prices are derived from these values using `lmsr_price(b, q_yes, q_no, side)`.

The canonical state is the single source of truth for pricing. Branch markup is applied on top of this price, not embedded within it.

**Canonical price impact cap:** No single trade (retail or branch) may move the canonical price by more than 5% in one execution. If a trade would exceed this, it is rejected. User sees "trade too large for current liquidity." This protects retail users from branch-driven price shocks and prevents any single actor from dramatically moving the market in one transaction. The 5% threshold is admin-configurable in `fee_config`.

---

## 3. Retail Execution Path

**Counterparty:** SOOQ.

**Execution:** User submits trade → `execute_retail_trade` → LMSR math calculates shares → `q_yes`/`q_no` update → shares issued, tagged as SOOQ-liability → user balance debited → SOOQ retail pool credited → trade recorded with full V1 fee model.

**Fee model:** Same as V1 — explicit fee (0.5%), AMM spread (tracked), dynamic spread, cash-out premium (0.5%), resolution fee (1%).

**Settlement pool:** SOOQ retail pool. Only retail trade cash enters this pool. At resolution, retail winners are paid from this pool. Instantly. Always.

**Risk control:** Per-market retail exposure cap. SOOQ tracks:

- Net retail cash collected per market (buys minus sell returns)
- Retail shares outstanding per side

Worst case = `(winning side retail shares × $0.99) - net retail cash collected`

When worst case hits the per-market cap, retail buying on the risky side pauses. Users can still sell. Users can still buy the other side. Branch trades are unaffected.

**Retail exposure cap value:** Default = `2 × liquidity_param` per market. Applied automatically when a market is created. Admin can override per market in the admin panel. This ensures every market has a cap even if admin forgets to set one manually.

This cap is SOOQ's primary risk control in S2. It replaces the pure `b × ln(2)` bounded-loss guarantee, which no longer holds when branch trades move the same LMSR without entering SOOQ's retail pool.

**Liquidity:** Full trade-in/trade-out at any time while the market is open. No restrictions. The LMSR is always available as counterparty.

**Max trade size:** Percentage of `b` (using `amm_max_trade_pct` from `fee_config`). Not tied to `total_volume`. Floor of $100 on fresh markets.

---

## 4. Branch Execution Path

**Counterparty:** The branch. Not SOOQ.

**Execution:** User submits trade through branch link or branch platform → **solvency gate check** → branch markup is extracted from user's gross amount → net canonical amount hits `execute_branch_trade` → same LMSR math calculates shares → `q_yes`/`q_no` update → shares issued, tagged as branch-liability with `branch_id` → user balance debited → branch pool credited (full gross amount: markup + net canonical) → trade recorded with full audit fields.

**Critical distinction:** `execute_branch_trade` calls the same LMSR math functions (`lmsr_cost`, `lmsr_price`, `lmsr_shares_for_cost`) as retail, but writes to different ledgers. These are two separate execution functions sharing a math library, NOT one function with a conditional branch.

**Solvency gate:** Before every branch trade, the system checks whether the branch pool can cover all obligations after the trade. See Section 23 for the exact formula and definitions.

Solvency gate behavior:
- Warning to branch panel at 80% pool utilization (yellow status)
- Hard block at 95% pool utilization (red status, trades rejected)
- Admin can override per branch for trusted operators (override logged with mandatory note, admin ID, and timestamp)

**Branch markup:** At launch, SOOQ-supported branch pricing is limited to flat YES markup % and flat NO markup % per branch, applied to all markets. Branch configures this in their panel. Default for new branches: 5% each side. Per-market or per-user markup logic is out of scope for launch, even if conceptually allowed later.

**Settlement pool:** Each branch has its own pool inside SOOQ. Only that branch's trade cash enters their pool. At resolution, branch winners are paid from the branch's pool. If the pool is sufficient, payout is instant. If insufficient, payout is pending — "contact your agent."

**SOOQ never covers branch payouts from its own funds. Ever.**

**Branch risk management:** Entirely the branch's responsibility. Tools available to branches (built into branch panel by SOOQ):

- Spread management — widen/narrow markup per side
- Per-user position cap per side per market — branch sets a max total position a single user can hold on YES or NO for a given market (e.g. $500 max YES per user on this market). Configurable as a global default across all markets, with optional per-market override.
- Market freezing — toggle markets on/off for their users
- Book balancing — adjust pricing to attract offsetting flow
- Cash-out control — enable/disable/pause user selling

**No hedging mechanism.** Branches cannot hedge on SOOQ's retail AMM. Risk management is through spreads, caps, freezing, and balancing only.

---

## 5. Branch Buy Ledger Flow

When a branch user buys:

```
0. Solvency gate: check branch can cover all obligations after this trade
   - Uses formula from Section 23
   - If utilization > 95% after trade → reject, user sees "market temporarily unavailable"
   - If utilization 80-95% → allow but warn branch panel
   - If pass → continue

1. User has $100 balance in SOOQ
2. Branch markup = $5 (per branch's pricing logic)
3. Net canonical amount = $95

Ledger writes:
- User balance:           -$100
- Branch pool:            +$100 ($5 markup + $95 canonical)
- LMSR q_yes/q_no:        updated based on $95 canonical execution
- Shares issued to user:  tagged with branch_id (branch-liability)
- Branch fee accrual:     $100 × branch_rate% recorded (collected at resolution)

Trade audit record:
- user_id
- branch_id
- agent_id (if applicable)
- gross_amount: $100
- branch_markup: $5
- net_canonical_amount: $95
- branch_quote_shown: the price/odds user saw
- canonical_pre_trade_yes_price
- canonical_pre_trade_no_price
- canonical_post_trade_yes_price
- canonical_post_trade_no_price
- shares_issued
- side
- timestamp
- idempotency_key
```

---

## 6. Branch Sell / Cash-Out Flow

When a branch user sells (closes position before resolution):

```
1. User holds X shares (branch-liability tagged)
2. LMSR math calculates gross sell proceeds: old_cost - new_cost
3. Branch exit fee deducted (per branch's configuration)
4. Net proceeds credited to user balance

Ledger writes:
- Branch pool:            -gross_proceeds
- User balance:           +net_proceeds (after branch exit fee)
- Branch pool:            +branch_exit_fee
- LMSR q_yes/q_no:        updated (shares removed from canonical state)
- User shares:            reduced

Trade audit record:
- Same fields as buy, plus direction='sell'
```

**Branch cash-out controls:**

- Branch can enable or disable selling per market
- Branch can pause selling during volatility
- Branch can charge any exit fee they choose
- If branch disables selling, user's shares still exist but cannot be sold until branch re-enables or market resolves

**If branch pool has insufficient funds for sell proceeds:** The sell is blocked. User sees "cash-out unavailable." Their shares remain. They can wait for the branch to top up (which re-enables cash-out) or hold until resolution (where payout may be pending if pool is still short). Branch sells are only allowed when the branch pool can fully satisfy the payout. This prevents branches from reducing their exposure without actually paying for it.

---

## 7. Resolution Settlement

When SOOQ resolves a market:

**Step 1 — Retail settlement (instant):**
- Identify all retail-tagged winning positions
- Pay each winner `shares × $0.99` from SOOQ retail pool
- Apply V1 resolution fee, commission, and revenue recording logic
- Retail losers: nothing happens, shares expire

**Step 2 — Branch settlement (per branch):**
- For each branch, identify branch-tagged winning positions
- Calculate total payout owed: `winning_shares × $0.99`
- **Pay branch winners first from branch pool** (winners are senior to SOOQ fee)
- If branch pool covers all winner payouts: pay all, then deduct SOOQ's fee (`total_branch_buy_volume × branch_rate%`)
- If branch pool is insufficient for all winners: pay what's available, remaining payouts marked as pending
- SOOQ's fee is calculated but becomes a receivable if the pool is exhausted by winner payouts
- **Settlement priority: branch winners > SOOQ fee.** SOOQ never takes its cut before winners are paid.
- Branch losers: nothing happens, shares expire

**Step 3 — Agent settlement (per branch):**
- For each agent under the branch, calculate earnings based on agent type:
  - **P/L agent:** `agent_rate% × net P/L from agent's users` (can be negative — see Section 17)
  - **Commission agent:** `agent_rate% × total buy volume from agent's users`
- Settlement amounts are recorded and visible in both branch and agent panels
- Actual payouts between branch and agent are handled externally by the branch (cash, USDT, whatever). SOOQ tracks the numbers only at launch.

**Step 4 — Webhook notification:**
- Send resolution webhook to all branches with markets they had active
- Webhook contains: market_id, outcome, resolution_timestamp
- Branch handles any internal settlement with agents/subagents on their side

---

## 8. Branch Fee Formula

| Parameter | Value |
|---|---|
| Base | Gross user buy amount (what the user committed, before markup extraction) |
| Rate | Dynamic per branch (negotiated, stored in `fee_config` per branch). Default: 5% |
| Volume counted | Buys only. Sells / cash-outs do NOT count toward fee volume |
| Collection | At market resolution, deducted from branch pool |
| Can contribute to negative | Yes |

Example: Branch rate is 5%. A branch user buys $100 of YES. SOOQ's fee = $100 × 5% = $5, collected from the branch pool at resolution.

**Branch withdrawal fee:** 1% charged when branches withdraw from their pool to external wallets (USDT/fiat). Not charged on internal credit chain movements (branch crediting agents/users).

**Branch withdrawal reserve lock:** Branch can only withdraw surplus above: worst-case liability across all active markets + pending payouts (see Section 23 for definitions). Admin can override for trusted branches (override logged with mandatory note, admin ID, and timestamp).

---

## 9. Payback Mode — Delinquent Branch State Machine

When a branch has pending unpaid payouts after resolution:

**Payback mode activates automatically. No manual intervention needed.**

**Rules during payback mode:**

| Rule | Status |
|---|---|
| Branch is live | Constrained — see below |
| New user deposits | Allowed — user's money, not branch's |
| Users open new positions | Only if trade passes payback-mode solvency gate (pending payouts fully reserved before new exposure is allowed) |
| All positive branch pool inflows swept to pending payouts | Yes — see sweep rule below |
| Branch withdrawals | Blocked |
| Branch credits to agents/users | Blocked — no new credit distribution down the tree |
| Users withdraw their own unused balance | Allowed — their money is theirs |

**Payback-mode solvency gate:** During payback mode, the solvency gate evaluates the post-trade branch pool (including the incoming gross stake from the new trade) but reserves pending payouts first. New exposure is only allowed from whatever remains after pending payouts are fully covered.

Example: Pool = $300, pending payouts = $200, new trade brings in $100 gross. Post-trade pool = $400. After reserving $200 for pending payouts, $200 remains. If the trade's worst-case fits within $200, it proceeds. If not, rejected.

**Payback sweep rule:** Any dollar that would increase the branch pool's available balance is swept to clear pending payouts first. This includes ALL positive branch cash movements:

- Losing branch-user stakes (user loses, money stays in branch pool → swept)
- Branch markup on new trades (the $5 markup on a $100 trade → swept)
- Branch exit fees on cash-outs (exit fee portion → swept)
- Any direct deposits by the branch manager into the branch pool → swept

The branch cannot access any distributable surplus until all pending payouts = $0. This is not "profits" — it is every positive inflow without exception.

**Escalation timeline:**

| Timeframe | Action |
|---|---|
| Day 0 | Payback mode activates. Branch notified. |
| Day 1-14 | Branch operates in constrained payback mode. New trades allowed only if solvency gate passes with pending payouts fully reserved. Losing trade proceeds clear pending payouts. |
| Day 14 | If pending payouts still exist: new position opening disabled. Branch can still operate existing positions but cannot expand exposure. Direct conversation with branch manager. |
| Day 30 | If still unresolved: full freeze. Branch goes read-only. All activity stops. Relationship conversation. |

**Exit from payback mode:** When all pending payouts are cleared, branch returns to normal operation. All restrictions lifted. No permanent record affecting the branch's trading capabilities.

---

## 10. Oracle Integrity Policy

### What makes this oracle trustworthy

Every trade that moves the canonical LMSR is funded by real money inside SOOQ. There are no unfunded trades, no phantom volume, no external reported flow that moves price without capital at risk.

### What this oracle is NOT

It is not a pure informational market price. It is a shared ecosystem price influenced by both direct market trading and bookmaker-mediated customer flow. Branch flow is real funded conviction but is partially shaped by branch pricing policy, book balancing, cash-out controls, and risk management decisions. This is acknowledged and accepted as a known property of the architecture.

### Integrity controls

**Built into architecture (launch):**

- Every LMSR-moving trade is funded by real user balance inside SOOQ
- Every branch trade carries full audit fields (gross amount, markup, net canonical, quote shown, branch_id, agent_id)
- branch_id tagged on every trade enables per-branch analysis
- SOOQ retains authority to suspend any branch's trading rights immediately
- SOOQ can void an entire market if severe manipulation is confirmed (see Section 22)
- **Branch velocity spike alert:** Admin is flagged if any branch's volume exceeds 5× their 7-day rolling average. Surfaced in admin panel as a notification. Manual review required — no auto-suspension.

**Acknowledged limitations:**

- SOOQ cannot surgically reverse individual branch trades from the LMSR after subsequent trades have occurred (price path is path-dependent)
- Manipulation is costly (requires real money) but not impossible — branches can still manipulate through related accounts, sockpuppet users, or intentional loss-making trades
- Branch book-management behavior (freezing exits, adjusting spreads) may indirectly influence canonical price flow

**Planned for post-launch:**

- Related-account and self-dealing detection
- Anomaly detection across branch trading patterns
- Wash-trade monitoring
- Automated branch suspension triggers

---

## 11. Money Movement — Credit Chain

All money lives inside SOOQ. Fully cash-backed. No credit lines. No lending.

**Deposit paths:**

- User deposits directly (3pay USDT, Whish, bank transfer)
- SOOQ Admin credits Branch Manager (after receiving real funds externally)
- Branch Manager credits Agents, Sub-agents, or Users directly
- Agents credit their own Sub-agents or Users

**Credit chain permissions:**

| Issuer | Can credit |
|---|---|
| SOOQ Admin | Branch Managers |
| Branch Manager | Any agent, sub-agent, or user under their branch |
| Agent | Their own sub-agents and users only |
| Sub-agent | Their own users only |

**Rules:**
- Credits flow downward only. No upward crediting, no cross-branch crediting.
- A credit can only be issued from an account with sufficient balance. You can only spend your own balance.
- Credits reduce the issuer's balance and increase the recipient's balance.
- No balance is created from nothing — every dollar traces back to a real deposit.

**Credit risk note:** Admin crediting a branch more than the cash received is an explicit credit risk decision. The pool balance is the effective credit limit — the solvency gate enforces trading limits based on what's in the pool. How much real cash was received vs how much was credited is a business decision, not a system concern. SOOQ may extend limited credit to trusted branches at admin's discretion.

**Every credit is recorded as an append-only ledger entry.** Same pattern as V1 transactions table.

**SOOQ manages:** the mechanical credit chain — who can credit whom, balance tracking, permissions, transfer limits.

**SOOQ does NOT manage:** business relationships between branch and agents — P&L splits, commission deals, agent recruitment, sub-agent agreements. That is the branch's internal business.

---

## 12. User Access Modes

Three ways to trade, available from day 1:

### SOOQ Direct

- URL: `sooq.app`
- Counterparty: SOOQ
- Pricing: Canonical LMSR price
- Trade sizes: Capped (percentage of `b`)
- Payouts: Instant at resolution, always
- Cash-out: Anytime, no restrictions
- Best price, limited size

### Branch White-Label

- URL: `sooq.app/b/{branch_code}`
- Counterparty: Branch (clearly labeled — "Operator: [Branch Name]", "Counterparty: [Branch Name]")
- Pricing: Branch-adjusted pricing (canonical + branch markup)
- Trade sizes: Subject to branch per-user position cap and solvency gate
- Payouts: From branch pool. Instant if funded. Pending if not — "contact your agent"
- Cash-out: Subject to branch policy (may be restricted or paused)
- Wider price, agent service

### Branch Own Platform (API)

- Branch builds their own frontend
- Connects to SOOQ via API for: price feed, trade execution, resolution webhooks
- Same branch execution path as white-label
- For sophisticated operators who want full brand control

**White-label separation requirements:**

- Distinct visual header/badge indicating operator mode
- Clear counterparty disclosure on every trade confirmation
- Separate support routing — branch users directed to branch/agent for payout issues
- Separate branding elements configurable by branch

---

## 13. Separate Pools and Ledgers

The following ledgers must exist independently:

### SOOQ Retail Pool
- Credits: retail user buy amounts
- Debits: retail user sell proceeds, retail resolution payouts
- Purpose: funds SOOQ's counterparty obligations for retail trades
- Protected by: per-market retail exposure cap (admin-configurable)

### Branch Pool (one per branch)
- Credits: branch user buy amounts (gross, including markup), losing trade proceeds
- Debits: branch user sell proceeds, branch resolution payouts, SOOQ branch fee
- Purpose: funds branch's counterparty obligations for their users
- Can go negative: yes (triggers payback mode)
- Protected by: solvency gate (pre-trade check, see Section 23)

### User Balances
- Each user has one balance regardless of how they entered (direct or branch)
- Funded by: direct deposits or credits from the chain (admin → branch → agent → user)
- Debited by: trades, withdrawals
- This is the user's money — always withdrawable (unused portion) regardless of branch status

### Canonical Market State
- `q_yes`, `q_no`, cached prices
- Updated by both retail and branch trades
- Not a money ledger — a mathematical state ledger

### Branch Trade Audit Ledger
- Full audit trail of every branch trade
- Fields defined in Section 5
- Append-only, never modified

### Credit Chain Ledger
- Full audit trail of every credit chain movement
- Fields: issuer_id, recipient_id, amount, timestamp, branch_id, type (credit/debit)
- Append-only, never modified

---

## 14. V1 Components Reused Unchanged

| Component | Source | Reuse |
|---|---|---|
| LMSR math functions | Migration 107 | Called by both `execute_retail_trade` and `execute_branch_trade` identically |
| `fee_config` pattern | Migration 009+ | Extended with per-branch fee rates |
| Append-only transaction ledger | Migration 004 | Pattern replicated for branch pool and credit chain ledgers |
| Locking discipline | `FOR UPDATE` on user row and `amm_state` | Same locking order preserved in both execution paths |
| Protected-column trigger | Migration 041 | Extended to new sensitive branch/pool columns |
| Webhook auth pattern (HMAC-SHA256) | 3pay/Whish webhooks | Reused for branch API authentication and resolution webhooks |
| Resolution flow | Migration 179 | Extended with branch settlement step after retail settlement |
| Reconciliation cron | check-errors cron | Extended to reconcile branch pool balances |

---

## 15. Explicit Non-Goals

This document does NOT define:

- Full API endpoint specifications for Branch Own Platform mode
- Automated branch risk management recommendations (odds shading engine, pricing suggestions)
- Payout operations workflow details beyond settlement logic
- KYC/AML procedures for branch onboarding
- Full surveillance engine specifications beyond velocity alerts
- Branch-to-branch transfer or cross-branch settlement
- Detailed error handling and edge case responses

These are all future work items. This document defines only the architectural boundaries.

---

## 16. Decisions Log

All decisions locked during the design process:

| # | Decision | Rationale |
|---|---|---|
| 1 | One LMSR, all trades move it | Best available ecosystem price from aggregated flow |
| 2 | Separate retail and branch execution paths | Different economics require different ledger writes |
| 3 | Separate settlement pools | SOOQ never covers branch payouts |
| 4 | Branch markup extracted before LMSR execution | Oracle sees clean post-markup funded trades |
| 5 | No hedging mechanism | Simplicity; branches manage risk through spreads/caps/freezing |
| 6 | No collateral required | Business credit risk accepted; money enters through credit chain |
| 7 | Branch fee dynamic per branch, on gross buy amount only | Negotiated rates; buys only prevents churn gaming |
| 8 | Fee collected at resolution | Operational simplicity; deducted from branch pool |
| 9 | Payback mode for delinquent branches | MENA relationship preservation; constrained recovery; 14-day escalation; 30-day freeze |
| 10 | White-label from day 1 | Distribution speed; clear visual/legal separation required |
| 11 | SOOQ creates all markets, branches toggle on/off | SOOQ controls market quality; branches control their offering |
| 12 | Resolution is final, no disputes | SOOQ is the authority on outcomes |
| 13 | Retail exposure cap replaces pure LMSR bounded loss | Branch flow breaks self-funding property; policy cap is real protection |
| 14 | Cash-backed only, no credit lines | Every dollar in system traces to real deposit |
| 15 | Oracle is "best available ecosystem price" not "pure informational" | Honest framing of branch flow influence |
| 16 | Underfunded branch sells are blocked | Prevents branches reducing exposure without paying; user sees "cash-out unavailable" |
| 17 | Settlement priority: winners before SOOQ fee | SOOQ fee becomes receivable if pool is exhausted; never take cut before winners are paid |
| 18 | Payback mode sweeps ALL positive branch inflows | Losing stakes, markup, exit fees, deposits — everything clears pending payouts before branch can access |
| 19 | Branch users see branch-adjusted quotes, not raw canonical | One underlying price, different execution quotes per access mode |
| 20 | Branch display mode is a config toggle, not a branch type | Same mechanics, different UI skin (trading vs betting) |
| 21 | Agent types: P/L or commission, set by branch | Two deal structures, tracked by SOOQ, settled externally by branch |
| 22 | Credit chain flows downward only | Branch → agents → sub-agents → users. No upward or cross-branch credits |
| 23 | 1% withdrawal fee on branch pool external withdrawals | Revenue line; not charged on internal credit chain movements |
| 24 | Agent sub-settlement tracked but not enforced | SOOQ shows the numbers; branch pays agents externally at launch |
| 25 | Solvency gate with soft thresholds | Warning at 80%, hard block at 95%, admin override for trusted branches |
| 26 | Branch markup constrained to flat % per side at launch | Simplification; per-market/per-user markup deferred |
| 27 | Per-user position cap per side per market, set by branch | Global default with optional per-market override; branch's risk management tool |
| 28 | Odds displayed from effective cost, not probability shading | Model A: odds = payout / gross cost per share. Matches ledger reality. |
| 29 | Withdrawal reserve lock with admin override | Branch withdraws only surplus above worst-case liability + pending payouts |
| 30 | Void = full refund at weighted average cost | Open positions refunded at WAC, past cash-outs not clawed back, fees cancelled |
| 31 | Quote validity off at launch, configurable | 30s TTL, 2% max slippage when enabled; not needed at current volume |
| 32 | Branch velocity alert at launch | 5× above 7-day average triggers admin notification; manual review only |
| 33 | Admin credit risk is a business decision | Pool balance = effective credit limit; admin may credit more than cash received |
| 34 | Payback mode allows constrained trading only | New trades must pass solvency gate with pending payouts fully reserved first |
| 35 | Confirmation screen always shows actual executed quote | Unconditional; not dependent on quote validity being enabled |
| 36 | Admin overrides require mandatory note + admin ID + timestamp | Governance control; logged in override audit trail |
| 37 | Void refund uses weighted average cost basis | No lot tracking; WAC across all fills for remaining shares |
| 38 | Worst-case liability floored at zero per market | No cross-market netting; each market evaluated independently |
| 39 | Zero/negative pool balance = utilization 100% | Solvency gate blocks all trades; no division by zero |
| 40 | Canonical price impact cap of 5% per trade | Protects retail from branch-driven price shocks; admin-configurable |
| 41 | Default retail exposure cap = 2× liquidity param | Every market has a cap automatically; admin can override |

---

## 17. Agent Model

Branches can create two types of agents:

### P/L Agent

- Receives a percentage of net P/L generated by their users
- Rate set by branch when creating the agent (e.g. 20%)
- **Positive P/L:** Agent's users lost money → agent earns their share (e.g. users lose $1,000, agent earns $200 at 20%)
- **Negative P/L:** Agent's users won money → agent owes their share (e.g. users win $500, agent owes $100 at 20%)
- Negative P/L carries forward — agent doesn't earn again until cumulative P/L returns to positive
- **Optional deposit:** Branch can require a deposit from P/L agents as a buffer against negative P/L. If set, negative P/L is auto-deducted from this deposit. If deposit hits zero, carry-forward applies.
- Settlement period: configurable by branch (weekly or monthly)

### Commission Agent

- Receives a flat percentage of buy volume generated by their users
- Rate set by branch when creating the agent (e.g. 2% of volume)
- Paid regardless of whether users win or lose
- Zero risk, lower upside
- No deposit required

### Agent Rules

- Each agent has a unique referral link that tags users to both the agent AND the parent branch
- All agent users trade against the branch's capital — the agent is never the counterparty
- An agent can create sub-agents below them (same two types: P/L or commission)
- Sub-agent users are also tagged to the parent branch for trade routing
- Agent sees: their users, their volume, P/L or commission earned, their sub-agents
- Branch sees: all agents, all sub-agents, all users, full hierarchy

### Agent Credit Chain

- Branch manager can credit agents from their own balance
- Agents can credit their own sub-agents and users from their own balance
- P/L agents with a required deposit: deposit is held in the agent's balance, earmarked for the branch. Auto-deducted on negative P/L settlements.

---

## 18. Branch Display Mode

Each branch has a `display_mode` config setting: `trading` or `betting`.

### Trading Mode
- Probabilities (0-100%)
- Shares, positions, portfolio
- Buy/Sell
- P/L shown in dollar terms
- Same visual language as SOOQ Direct retail

### Betting Mode
- Decimal odds (e.g. 1.52, 2.40)
- Stake, potential winnings, bet slip
- "Place Bet" instead of "Buy Shares"
- Winnings shown instead of payout
- Feels like a sportsbook

**Underlying mechanics are identical.** The display mode only changes labels, formatting, and UI components. The execution path, ledger writes, settlement, and all business logic are the same regardless of display mode.

**Default for new branches:** Betting mode.

**Odds calculation (Model A — stake haircut):**

The displayed odds reflect what the user actually pays and actually receives. Markup is a stake haircut, not probability shading.

- User pays `gross_cost_per_share` (canonical price + branch markup portion per share)
- User receives `$0.99` per winning share (after resolution fee)
- Decimal odds = `payout_per_share / gross_cost_per_share` = `0.99 / gross_cost`

Example:
- Canonical YES price = $0.60
- Branch markup = 5% of gross amount
- Effective gross cost per share ≈ $0.632
- Decimal odds = 0.99 / 0.632 = **1.57**
- User stakes $100, receives ≈ 158 shares, wins $156.42 if YES resolves

The odds shown to the user match the economics of their trade exactly. No disconnect between display and ledger.

**Confirmation screen rule (unconditional):** Regardless of whether quote validity (Section 21) is enabled, the trade confirmation screen must always show the actual executed quote — the real price/odds the user is getting at the moment of execution, not a stale preview value.

---

## 19. Branch Panel Specification

The branch panel is the branch operator's dashboard. Accessible at `sooq.app/branch/dashboard` (authenticated).

### Overview Screen
- Pool balance (total deposited, available, locked in exposure)
- Solvency status indicator (green < 80%, yellow 80-95%, red > 95%)
- Total P/L (all time, this week, today)
- Active users count
- Active markets count
- Payback mode status (if applicable — shows pending payout amount, sweep progress, escalation timeline)

### Exposure Screen
- Per-market breakdown: YES exposure, NO exposure, worst-case payout, net position
- Total portfolio worst-case liability vs available capital (see Section 23 for definitions)
- Solvency gate proximity indicator
- Toggle markets on/off for their users

### Users & Trades Screen
- List of all users under this branch (with which agent referred them)
- Trade history with full audit fields
- Per-user P/L, volume, position summary
- Per-user position cap status (how close to limit)

### Agent Management Screen
- Create new agent: set type (P/L or commission), rate, optional deposit requirement
- Agent list: name, type, rate, users count, volume generated, earned/owed
- Per-agent detail: their users, their sub-agents, P/L or commission breakdown
- Agent referral links

### Config Screen
- Markup per side (YES %, NO %)
- Display mode toggle (trading / betting)
- Per-user position cap per side (global default)
- Per-market position cap overrides
- Cash-out enabled/disabled per market
- Exit fee percentage
- Branch withdrawal (to external wallet, 1% fee, subject to reserve lock)

### Agent Mini Panel
- Agents see: their users, their volume, their earnings (P/L or commission), their sub-agents
- Agents can: create sub-agents, credit users/sub-agents from their balance, view their referral link
- Agents cannot: see other agents, see branch-level financials, change branch config

---

## 20. Admin Panel Extensions

The SOOQ admin panel must be extended with:

### Branch Management Screen
- List all branches: name, status (active/payback/frozen), pool balance, total volume, total P/L, fee rate, solvency status
- Per-branch detail: full exposure view, all users, all agents, trade audit log
- Credit branch manager (after receiving real funds externally)
- Credit risk view: real cash received vs amount credited per branch
- Suspend/unsuspend branch trading rights
- Adjust per-branch fee rate
- Admin override controls: loosen solvency gate, allow withdrawal past reserve lock (all overrides require mandatory note, admin ID, timestamp — logged in override audit trail)

### Branch Monitoring
- Real-time exposure across all branches
- Solvency status dashboard (green/yellow/red per branch)
- Payback mode alerts
- Branch approaching freeze threshold warnings
- Branch pool balance alerts (low capital)
- **Velocity alert dashboard:** Flags when any branch's volume exceeds 5× their 7-day rolling average. Manual review required.

### Resolution Extensions
- Resolution flow now shows two-step settlement: retail first, then per-branch
- Admin sees: retail payout total, per-branch payout total, per-branch fee collected, any pending payouts
- Admin can see receivables (fees owed by branches in payback mode)

### Market Management Extensions
- Per-market retail exposure cap config (adjustable by admin)
- Per-market view: retail exposure + branch exposure breakdown
- Void market action (see Section 22)

### Credit Chain Admin
- View full credit chain tree: admin → branches → agents → sub-agents → users
- Audit trail of all credits issued
- Override audit trail: every admin override with mandatory note, admin ID, and timestamp

---

## 21. Quote Validity

**Off by default at launch.** Configurable — enable when volume justifies it.

When enabled:

| Parameter | Value |
|---|---|
| Quote TTL | 30 seconds |
| Max slippage | 2% |
| Trigger | If canonical price moves > 2% between quote display and execution |
| Action | Trade rejected, user prompted to requote at current price |

**Unconditional rule (applies even when quote validity is off):** The trade confirmation screen must always display the actual executed quote, not the preview quote. This is not optional. See also Section 18.

---

## 22. Market Voiding

Admin can void any market at any time. Void is a last resort for markets that cannot be fairly resolved.

**When to void:**
- Ambiguous market wording with no clear resolution
- Confirmed manipulation affecting market integrity
- Event cancelled — neither YES nor NO applies
- Market creation error (wrong date, wrong wording, duplicate)
- Resolution sources contradict each other with no deterministic tiebreaker

**Void settlement rules:**

- All open positions are refunded at **weighted average cost (WAC)** per share — the average price the user paid across all their fills for that position. No lot-level tracking; WAC is the single cost basis method.
- If a user partially cashed out before the void, only remaining shares are refunded at WAC. Cash-outs already taken are NOT clawed back.
- Branch pool returns branch users' original stakes (at WAC)
- Retail pool returns retail users' original stakes (at WAC)
- SOOQ fees accrued on the voided market are cancelled (not collected)
- Branch fees accrued on the voided market are cancelled (not collected)
- Void is final — market cannot be re-opened or re-resolved

**Void is recorded in the audit log with admin reason (mandatory note, admin ID, timestamp).**

---

## 23. Solvency Definitions

This section provides the canonical definitions used by the solvency gate, withdrawal reserve lock, and branch panel indicators.

### Worst-Case Liability (per market, per branch)

For a single market, the branch's worst-case liability is the maximum payout the branch could owe if all winning-side users collect:

```
worst_case_market = max(
  0,
  max(
    branch_yes_shares × $0.99,
    branch_no_shares × $0.99
  ) - branch_pool_cash_collected_for_this_market
)
```

**Floored at zero.** A market where cash collected exceeds worst-case payout does not produce a negative liability. No cross-market netting — each market is evaluated independently and cannot offset another market's risk.

Where:
- `branch_yes_shares` = total YES shares held by this branch's users for this market
- `branch_no_shares` = total NO shares held by this branch's users for this market
- `$0.99` = payout per winning share (after resolution fee)
- `branch_pool_cash_collected_for_this_market` = net cash the branch pool received from trades in this market (buys minus sell payouts)

### Worst-Case Liability (total, per branch)

Sum of per-market worst cases across all active (unresolved) markets:

```
worst_case_total = SUM(worst_case_market) for all active markets where branch has positions
```

**Implementation note:** `worst_case_total` should be maintained as a cached value on the branch row, updated incrementally on each trade, rather than recomputed from scratch on every solvency check. Recomputing across all active markets on every trade is too expensive at scale.

### Pool Utilization

```
utilization = (pending_payouts + worst_case_total) / branch_pool_balance
```

Where:
- `pending_payouts` = unpaid winner obligations from already-resolved markets (if in payback mode, otherwise 0)
- `worst_case_total` = as defined above
- `branch_pool_balance` = current branch pool balance

**Zero or negative pool balance:** If `branch_pool_balance` ≤ 0, utilization is treated as 100% (red). The solvency gate blocks all new trades. The branch is either in payback mode or should be. No division is performed — the gate simply returns "blocked."

Utilization thresholds:
- < 80%: green (healthy)
- 80-95%: yellow (warning displayed in branch panel)
- ≥ 95%: red (solvency gate blocks new trades)

### Withdrawal Available

```
withdrawal_available = branch_pool_balance - pending_payouts - worst_case_total
```

If `withdrawal_available` ≤ 0, external withdrawals are blocked. If positive, branch may withdraw up to that amount (1% fee applies). Admin can override (mandatory note, admin ID, and timestamp required).

### Solvency Gate (pre-trade check)

Before a branch trade executes:

```
post_trade_utilization = (pending_payouts + worst_case_total_after_trade) / (branch_pool_balance + incoming_gross_stake)
```

The incoming gross stake is counted in the post-trade pool because the trade deposits money into the branch pool. The worst-case total is recalculated including the new position.

If `post_trade_utilization ≥ 0.95`, trade is rejected.
If `post_trade_utilization ≥ 0.80`, trade proceeds but branch panel shows yellow warning.

All calculations use pre-fee amounts. SOOQ's branch fee is collected at resolution, not at trade time, so it does not factor into real-time solvency.

---

*This document is the architectural boundary for S2. Implementation specs, database schemas, and API designs are built within these boundaries.*
