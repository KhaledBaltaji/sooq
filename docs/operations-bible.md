# Sooq Operations Bible — Every Role, Every Flow, Every Relationship

## Why This Document Exists

You asked to understand the full operational picture once and for all. This covers what every actor in the system does, what they should know, what they can/can't do, how money flows between them, and how the relationships work.

---

## 1. THE USER (End Customer)

### What They Do
- Browse markets, buy/sell prediction shares (YES/NO) at real-time LMSR prices
- Deposit money (3pay crypto or Whish mobile), withdraw with admin approval
- Cash out positions anytime while market is open (not just at resolution)
- View their portfolio, P&L, trade history, leaderboard position

### What They Pay (Mostly Hidden)
| Fee | When | Rate | Visible? |
|-----|------|------|----------|
| Explicit fee | Every buy & sell | 0.5% | Yes (shown) |
| AMM spread | Every buy & sell | ~2-3% | No (baked into price) |
| Dynamic spread | Buys on heavy side (>65%) | ~0.5% avg | No |
| Cash-out premium | Every sell | 0.5% | No (baked into proceeds) |
| Resolution fee | When winning | 1% | Barely (payout is $0.99 not $1.00) |
| **Effective round-trip** | | **~5%** | |

### What They Can't Do
- See fee breakdown (subliminal model — they just see prices)
- Withdraw without admin approval
- Withdraw within 24hrs of first deposit
- Withdraw if wagering requirement not met (bonus users: must wager 2x bonus)
- Trade if account is frozen

### Deposit Bonus
- $5 free on first deposit of $20+
- **Only for organic (non-referred) users** — referred users do NOT get this
- Creates $10 wagering requirement (must place $10 in buys before withdrawing)

### Both-Side Trading
- Users CAN hold both YES and NO on the same market
- Every trade generates commission regardless (revenue-based, not exposure-based)
- Admin gets alerted if someone is trading both sides (potential wash trading)

---

## 2. THE AGENT (Referral Agent — V1 System)

### What They Are
Any user who refers others. You don't "apply" to be an agent — you just start sharing your referral code. The system tracks everything automatically.

### What They Need to Know

**The activation gate is the first hurdle:**
- Commissions are **escrowed** (held, not paid) until you get 5 qualified referrals
- "Qualified" = referral who placed at least 1 trade (not just signed up)
- Once referral #5 places their first trade → all escrowed commissions release at once
- Admin can override this gate manually

**How they earn:**
- Commission = % of **total platform revenue** on each trade by their referrals
- Platform revenue = explicit_fee + AMM spread + cash-out premium (~5% of trade volume)
- They earn on EVERY trade their referrals make (buys AND sells), not just at resolution

**Two layers only:**
```
You (Agent) → referred User A → User A referred User B

When User A trades: You earn Layer 1 (direct) commission
When User B trades: You earn Layer 2 (indirect) commission
If User B refers User C: You earn NOTHING on User C (beyond 2-layer limit)
```

**Agent levels (based on network volume, not referral count):**

| Level | Network Volume | Layer 1 | Layer 2 | Total Take |
|-------|---------------|---------|---------|------------|
| L1 (Starter) | <$10K | 30% | 5% | 35% of platform revenue |
| L2 (Active) | $10K+ | 35% | 8% | 43% |
| L3 (Power) | $50K+ | 40% | 10% | 50% |
| L4 (Elite) | $200K+ | 50% | 12% | 62% |

Network volume = total USD traded by ALL users in your referral tree (direct + indirect).
Levels only go UP (ratchet — you never lose a level).

**Agent wallet is separate from trading balance:**
- Commission earnings go to `agent_balance_usd` (not your trading wallet)
- You must explicitly transfer from agent wallet → portfolio to trade or withdraw
- This prevents accidentally gambling your commission earnings

**What happens when markets void:**
- ALL commissions from that market are clawed back (both escrowed and already credited)
- This is non-negotiable — voided markets mean all money returns

### What Agents Should Tell Their Referrals
- "Sign up with my code, trade on markets you believe in"
- They should NOT promise specific returns or guaranteed earnings
- They should NOT encourage wash trading (both-side trading to farm commissions)

### Agent Dashboard Shows
- Network tree visualization (who referred whom)
- Commission feed (real-time earnings, filterable by Layer 1/2)
- Tier progress (how much more volume needed for next level)
- Activation status (if not yet activated, shows progress to 5 qualified referrals)

---

## 3. THE BRANCH (Partner Bookmaker / White-Label Operator)

### What a Branch Is
A branch is a **semi-independent partner** that operates their own prediction market front under Sooq's infrastructure. Think of it like a franchise — they use the same LMSR engine, same markets, same prices, but they:
- Add their own markup on top
- Manage their own users and agents
- Handle their own pool of money
- Take their own risk

### How a Branch Makes Money

**The markup model:**
```
User wants to buy $100 YES on a branch:
1. Branch extracts 5% markup = $5 → goes to branch pool
2. Remaining $95 hits the canonical LMSR AMM
3. User gets shares based on $95 worth (slightly fewer shares than retail)
4. Branch also charges exit_fee (0.5%) when user sells

Result: Branch user pays more per share than retail user,
        but sees the same market and same price movements.
```

**Branch revenue streams:**
- YES/NO markup on buys (configurable per branch, default 5% each)
- Exit fee on sells (configurable, default 0.5%)
- Resolution fee portion (at market settlement)

**Branch costs:**
- Platform fee to Sooq (`branch_fee_rate`, default 5% of gross buy volume)
- Agent payouts (if they have agents under their branch)
- User payouts when markets resolve in users' favor

### Branch Pool & Solvency

**The branch IS the counterparty to their users' trades.** This is the critical thing to understand.

- Retail users trade against Sooq's AMM → Sooq bears the risk
- Branch users trade against the branch's pool → The branch bears the risk

**Pool mechanics:**
- Branch starts with a funded pool (initial deposit by branch manager)
- Buys by users → money flows INTO pool (markup + canonical amount)
- Sells by users → money flows OUT of pool (proceeds to user)
- Resolution payouts → money flows OUT of pool (winners get paid)
- Branch profit = markup collected + losing bets - winning payouts

**Solvency gate (automatic):**
```
Utilization = (pending_payouts + worst_case_total) / pool_balance

< 80%  → Green (healthy, all trades allowed)
80-95% → Yellow (warning shown to branch manager)
≥ 95%  → Red (new trades BLOCKED until pool topped up)
```

**Worst-case total** = across all open markets, the maximum the branch could owe if every market resolved in the worst direction for the branch.

### Payback Mode (When Branch Can't Pay)

If a branch can't cover payouts after a market resolves:

```
ACTIVE (healthy)
  ↓ pool can't cover payouts
PAYBACK (auto-activated)
  - All positive inflows sweep toward paying pending payouts
  - Withdrawals blocked for branch manager
  - Credit distribution to agents blocked
  - Can still accept new bets (if solvency gate passes)
  ↓ 14 days in payback without clearing
FROZEN
  - New positions disabled
  - Existing positions can still be sold
  ↓ 30 days frozen
SUSPENDED
  - Branch fully disabled
  - Admin intervention required
```

### Branch ↔ Agent Relationship

**Branch agents are a SEPARATE system from V1 referral agents.**

- V1 agents: automatic, referral-code-based, commission on platform revenue
- Branch agents: application-based, approved by branch manager, two types of deals

**Branch agent types:**

| Type | How They Earn | Risk |
|------|--------------|------|
| Commission | Flat % of buy volume they bring in | No risk — paid regardless of market outcome |
| P/L Share | % of net profit/loss on their users' trades | Share upside AND downside with branch |

**Agent application flow:**
1. User visits `/b/[branch_code]/agent/` and applies
2. Status = `pending`
3. Branch manager reviews and either:
   - **Approves** with deal terms (type, rate, required deposit)
   - **Rejects** with optional reason
4. Approved agents get their own referral code within the branch
5. Users who sign up via that code are assigned to both the branch AND the agent

**Sub-agent hierarchy:**
- Branch agents can have sub-agents (parent_agent_id)
- Creates a hierarchy: Branch Manager → Agent → Sub-Agent → Users
- Money flows: Users trade → Branch pool → Agent payout → Sub-agent share

### What Branch Managers Should Know

1. **You are the house.** Your pool is at risk. If markets go against you, you pay.
2. **Set markup wisely.** Too high = users go to retail Sooq. Too low = thin margins.
3. **Watch solvency daily.** If utilization goes yellow, top up the pool.
4. **Agent deals are binding.** Once you approve a P/L agent, you share losses too.
5. **You can't withdraw during payback.** Keep reserves above worst-case.
6. **Platform takes its cut regardless.** The `branch_fee_rate` (5%) is non-negotiable from admin.
7. **Display mode choice matters.** "Trading" mode shows prices. "Betting" mode shows odds. Choose what your market understands.
8. **Cash-out can be disabled.** Per-market or globally. Disabling it means users can only exit at resolution (higher risk for users, more predictable for you).

---

## 4. THE ADMIN (Platform Operator — You)

### What Admin Controls

**Markets (the product):**
- Create markets (question EN/AR, description, category, liquidity parameter, open/close dates)
- Edit market metadata (description, close date, keywords)
- Lock market (stop trading, typically before resolution)
- Resolve market (PIN-protected, irreversible — pays winners at $0.99/share)
- Void market (refund all positions, claw back all commissions)

**Users (the customers):**
- View any user's full profile: balance, transactions, trades, referral chain
- Freeze/unfreeze accounts (blocks all trading and withdrawals)
- Credit/debit user balances (PIN-protected, max $10K per operation, full audit trail)
- Override agent activation (bypass the 5-referral gate)

**Fees (the revenue):**
- All fee rates are in `fee_config` table, editable via PIN-protected RPC
- Can adjust: explicit fee, resolution fee, cash-out premium, deposit fee, withdrawal fee
- Can adjust: AMM liquidity parameter, max trade percentage, dynamic spread settings
- Can adjust: all 16 commission rate rows (4 levels × 2 layers × trade + resolution)

**Branches (the partners):**
- Create branches (assign manager, set markup/fee config, PIN-protected)
- Change branch status (active/payback/frozen/suspended)
- Override solvency gate (temporary, max 7 days, with mandatory note)
- Adjust branch pool balance (credit/debit, PIN-protected)
- Override withdrawal blocks (force-allow withdrawal even during payback)
- Configure webhooks (URL + HMAC-SHA256 secret for event notifications)

**Finance (the money):**
- View all deposits and withdrawals
- Approve or reject pending withdrawals (rejection refunds the user)
- Balance reconciliation: flags if `balance_usd ≠ SUM(transactions)` by >$0.01
- Accounting dashboard: Platform P&L, AMM state, Branch revenue, Commission payouts

**Monitoring (the health):**
- System logs with severity filtering and acknowledgment
- Lopsided market alerts (>90% or <10% on one side with volume >$50)
- Balance mismatch alerts
- Cron job: `check-errors` every 10min → Slack alerts
- Health endpoint: `/api/health` checks DB connectivity
- User geographic heatmap

**Support (the service):**
- View all support tickets (web + Telegram)
- Reply to tickets (takes over from AI)
- Help center CMS (create/edit collections and articles, bilingual)

### Admin ↔ Branch Relationship

**Admin is the platform. Branches are counterparties.**

| Dimension | Admin's Role | Branch's Role |
|-----------|-------------|---------------|
| Markets | Creates and resolves markets | Uses them (can't create or resolve) |
| Pricing | Sets base AMM + fee rates | Adds markup on top |
| Risk | Bears retail trading risk | Bears their own users' risk |
| Revenue | Takes branch_fee_rate (5%) from branches | Keeps markup + exit fees minus platform cut |
| Solvency | Monitors, can override gates | Must maintain pool above worst-case |
| Users | Can see all users across all branches | Can only manage users in their branch |
| Agents | Can override activation for V1 agents | Approves/rejects branch-specific agents |

**Counterparty risk (Admin perspective):**
- If a branch goes into payback → Sooq is NOT liable for branch users' payouts
- Branch users' money sits in the branch pool, NOT in Sooq's main pool
- If branch reaches SUSPENDED status → admin intervention needed (manual settlement)
- The platform fee (branch_fee_rate) is collected regardless of branch profitability

**Profit sharing:**
```
Branch user trades $100:
  → User pays $105 (with 5% markup)
  → $5 markup → branch pool
  → $100 canonical → LMSR execution
  → $0.50 explicit fee (0.5%) → platform revenue
  → $5.00 SOOQ fee (5% of $100 gross buy volume) → deducted from pool at buy time
  → AMM spread (~$2.50) → embedded in LMSR pricing
  → Platform revenue tracked separately from branch revenue
```

### Admin ↔ Main Branch Users

"Main branch" = retail Sooq (no branch code, `branch_id IS NULL`).

- Admin IS the counterparty for retail users (Sooq bears the AMM risk)
- No markup — users trade directly at LMSR prices
- V1 referral commissions apply (agent system)
- Admin approves/rejects withdrawals for all retail users

### Admin ↔ V1 Agents

- Can view all agents, their networks, commission history
- Can force-activate agents (bypass 5-referral gate)
- Can adjust commission rates globally (via fee_config)
- Cannot selectively give one agent a different rate (all agents at same level get same rate)

---

## 5. OPERATIONAL EMPLOYEES — What Each Role Needs to Know

### Market Operations Person
**Job:** Create markets, monitor trading, resolve markets on time.

**Must know:**
- How to create bilingual markets (EN/AR questions, good descriptions)
- When to lock markets (before the outcome event, prevent last-second trades)
- When to resolve (after outcome is confirmed, needs 6-digit PIN)
- When to void (bad market, ambiguous outcome, legal issues)
- Resolution is IRREVERSIBLE — double-check the outcome
- Voiding claws back ALL commissions — agents will lose earnings
- Monitor lopsided markets (admin alerts page) — extreme prices may indicate bad liquidity param
- Liquidity parameter (`b`) affects price sensitivity: higher b = more stable prices, needs more capital

### Finance/Accounting Person
**Job:** Approve withdrawals, monitor deposits, track revenue.

**Must know:**
- Every withdrawal needs manual approval (review amount, user history, wagering completion)
- Rejected withdrawals automatically refund the user
- Deposit reconciliation: if `balance_usd ≠ SUM(transactions)`, investigate immediately
- The accounting dashboard shows: Platform P&L, per-market AMM state, branch revenue, commission payouts
- Resolution fee (1%) is platform revenue — it comes from winning users' payouts
- Admin credits/debits need PIN and have $10K limit — use for corrections, promotions, refunds

### Support Person
**Job:** Handle escalated support tickets (AI handles first line).

**Must know:**
- AI answers first using help center articles
- When AI can't help, ticket escalates to human queue
- Once you reply, AI is disabled on that ticket (you own it)
- Users can also reach support via Telegram bot
- Telegram messages create the same tickets as web
- For account issues: verify identity via OTP before making changes

### Branch Relationship Manager
**Job:** Onboard branches, monitor solvency, manage partnerships.

**Must know:**
- Branch creation requires: name, unique code, manager user, config (markups, fees, mode)
- Monitor branch solvency daily — yellow = warning, red = blocked
- If branch hits payback: they can't withdraw until pending payouts cleared
- Payback → 14 days → Frozen → 30 days → Suspended (escalation is automatic)
- Admin can override solvency temporarily (max 7 days) for trusted partners
- Branch fee rate (platform's cut) is configurable per branch
- Branch agents are managed BY the branch, not by you — but you can see everything
- Webhook configuration lets branches get real-time event notifications

---

## 6. MONEY FLOW SUMMARY (End-to-End)

### Retail User Trade ($100 Buy)
```
User balance: -$100.00
  ├─ Explicit fee:     $0.50  → platform revenue
  ├─ Dynamic spread:   $0.25  → platform revenue (if price >65%)
  ├─ AMM spread:       $2.25  → platform revenue (embedded in LMSR)
  └─ Net to AMM:      $97.00  → LMSR execution → shares issued

Platform revenue this trade: $3.00
  ├─ Agent L1 commission: $0.90 (30% at Level 1) → agent wallet
  ├─ Agent L2 commission: $0.15 (5% at Level 1)  → agent wallet
  └─ Platform keeps:      $1.95

At resolution (if user wins, holds 100 shares):
  Payout: 100 × $0.99 = $99.00
  Resolution fee: 100 × $0.01 = $1.00 → platform revenue
  Resolution commission: $1.00 × agent rates → agent wallets
```

### Branch User Trade ($100 Buy, 5% Markup)
```
User pays: $105.00
  ├─ YES markup:       $5.00  → branch pool
  └─ Canonical amount: $100.00
       ├─ Explicit fee:   $0.50  → split (95% platform, 5% branch)
       ├─ AMM spread:     $2.50  → LMSR pricing
       └─ Net to AMM:    $97.00  → LMSR execution → shares issued

Branch pool receives: $5.00 markup + portion of fees
Platform receives: explicit fee share + AMM spread tracking

At resolution (if user wins):
  Branch pool pays: shares × $0.99
  Platform collects: branch_fee_rate on settlement
  If branch pool insufficient: payback mode activates
```

---

## 7. KEY RELATIONSHIPS MATRIX

| From → To | Financial Relationship | Operational Relationship |
|-----------|----------------------|------------------------|
| User → Platform | Pays fees (~5% per round trip) | Uses platform to trade |
| User → Agent | Generates commission for agent via trades | Referred by agent, may not even know |
| Agent → Platform | Earns % of platform revenue, keeps in agent wallet | Uses referral code, views dashboard |
| Agent → User | No direct financial relationship | Recruits users, may advise them |
| Branch → Platform | Pays branch_fee_rate (5%) to platform | Uses platform's LMSR, markets, infra |
| Branch → Users | Counterparty (pays winners, collects from losers) | Provides trading interface, manages accounts |
| Branch → Agents | Pays commission or shares P/L | Approves applications, sets deal terms |
| Admin → Branches | Collects platform fee, monitors solvency | Creates, configures, can override/suspend |
| Admin → Users | Credits/debits, freezes, approves withdrawals | Full visibility and control |
| Admin → Agents | Sets commission rates globally | Can override activation gate |

---

## 8. WHAT EACH PERSON SHOULD NOT KNOW / NOT HAVE ACCESS TO

| Actor | Cannot See / Cannot Do |
|-------|----------------------|
| User | Fee breakdown (subliminal), other users' balances, other users' trades, admin panel |
| Agent | Other agents' networks, other agents' commissions, admin controls, fee config |
| Branch Manager | Other branches' data, retail users' data, admin controls, fee config changes |
| Branch Agent | Other branch agents' deals, branch pool balance, branch solvency details |
| Admin | Production database directly (CI/CD only), cannot undo a resolution |

---

## 9. RISK MAP

| Risk | Who Bears It | Mitigation |
|------|-------------|------------|
| AMM loss (retail) | Platform (Sooq) | Liquidity parameter tuning, position caps |
| AMM loss (branch) | Branch | Solvency gate, payback mode escalation |
| Agent commission gaming | Platform | Revenue-based (not exposure), escrow gate, void clawback |
| Branch insolvency | Branch users (delayed payouts) | Auto payback mode, admin monitoring, suspension |
| Wash trading | Platform (lost commissions) | Both-side alerts, manual review |
| Bonus abuse | Platform | Non-referred only, wagering requirement, buys-only counting |

---

## 10. DEEP DIVE: Branch ↔ Agent Deal Mechanics

### Two Deal Types Explained

When a branch manager approves an agent, they pick ONE deal type and set a rate:

#### Commission Agent (Safe, Predictable)
- **Earns:** `rate × total buy volume` from their referred users
- **Example:** Rate = 2%, users buy $10,000 total → agent earns $200
- **Risk:** Zero. Paid regardless of whether users win or lose.
- **When paid:** At market resolution, summed across all trades
- **Best for:** Agents who bring volume but don't want skin in the game
- **Branch perspective:** Fixed cost per dollar of volume. Predictable.

#### P/L Agent (High Risk, High Reward)
- **Earns:** `rate × net P/L from their users`
- **Example:** Rate = 20%, users collectively LOSE $5,000 → agent earns $1,000
- **But also:** Rate = 20%, users collectively WIN $5,000 → agent OWES $1,000
- **Risk:** Real. Agent shares the branch's upside AND downside.
- **Negative carry-forward:** If agent goes negative, they don't earn again until cumulative P/L returns to zero
- **Deposit collateral:** Branch can require upfront deposit. Negative P/L deducted from deposit first, then carry-forward.
- **Best for:** Experienced agents who understand the market and can manage their user base
- **Branch perspective:** Aligns incentives — agent wants their users to lose (same as branch)

### Application → Approval Flow (Exact Steps)

```
1. User visits /b/[branch_code]/agent/ → clicks "Apply"
   → RPC: apply_branch_agent(branch_id)
   → Creates row: status='pending', agent_type=NULL, rate=NULL
   → User sees: "Application Under Review"

2. Branch manager sees pending application in their dashboard
   → Reviews user's profile, trading history
   → Decides deal terms:
     - Type: P/L or Commission
     - Rate: 0.1% to 100% (they set this)
     - Deposit required: $0+ (optional collateral for P/L agents)

3a. APPROVE → RPC: approve_branch_agent(agent_id, type, rate, deposit)
    → Status = 'approved', is_active = true
    → Agent gets unique 8-char referral code
    → Agent can now recruit users under this branch

3b. REJECT → RPC: reject_branch_agent(agent_id, reason)
    → Status = 'rejected' (FINAL — cannot reapply currently)
    → Agent sees rejection reason
```

### Changing Deal Terms After Approval

Branch manager can update terms anytime via `update_branch_agent_deal`:
- Can change type (P/L ↔ Commission)
- Can change rate
- Can change deposit requirement
- Takes effect immediately (no retroactive recalculation)
- Does NOT require re-approval

### Sub-Agent Hierarchy

```
Branch Manager (Rank 1)
  └── Agent A (Rank 2, parent_agent_id = NULL)
       ├── Sub-Agent A1 (Rank 3, parent_agent_id = Agent A)
       │    └── Users assigned to A1
       └── Sub-Agent A2 (Rank 3, parent_agent_id = Agent A)
            └── Users assigned to A2
  └── Agent B (Rank 2, parent_agent_id = NULL)
       └── Users assigned to B
```

**Key rules:**
- Sub-agents can be different type than parent (P/L parent can have Commission sub-agent)
- Each sub-agent has their own referral code
- Users assigned to sub-agents are still in the parent BRANCH (trade against branch pool)
- Sub-agents have independent cumulative_pl tracking

### Credit Chain (How Money Flows Down the Hierarchy)

Money flows **downward only** via `branch_credit_transfer`:

```
Admin → Branch Manager → Agent → Sub-Agent → User
  ✓         ✓              ✓         ✓         (end)
  
NEVER: User → Agent, Agent → Branch Manager, Sub-Agent → Agent
```

**Rules:**
- Max $100,000 per transfer
- Balance check before debit (sender must have funds)
- Both parties cannot be frozen
- **BLOCKED during payback/frozen/suspended** (no credit distribution when branch is in trouble)
- Every transfer creates: 2 transaction ledger entries + 1 credit_chain_ledger audit row + system log

**Verification:** The system validates the hierarchy — Agent A can only credit Sub-Agent A1 (their own sub-agent), not Sub-Agent B1 (different parent).

### Settlement Reality Check

**Important:** Settlement is tracked but NOT auto-transferred.
- `cumulative_pl` on each agent records what they've earned/owed
- But Sooq does NOT automatically move money from branch pool to agent balance
- Branch manager must manually credit agents from their own balance via credit chain
- This is a business arrangement between branch and agent — Sooq just tracks the numbers

---

## 11. DEEP DIVE: Admin ↔ Branch Risk Management

### Solvency Math (Exact Formulas)

```
Per-market worst case:
  worst_case_market = MAX(0, 
    MAX(all_yes_shares × $0.99, all_no_shares × $0.99) - pool_cash_collected
  )

Aggregate:
  worst_case_total = SUM(worst_case_market) across all open markets

Utilization:
  utilization = (pending_payouts + worst_case_total) / pool_balance

Available for withdrawal:
  withdrawal_available = MAX(0, pool_balance - pending_payouts - worst_case_total)
```

### Solvency Thresholds

| Utilization | Status | Effect |
|-------------|--------|--------|
| < 80% | Green | All operations normal |
| 80-95% | Yellow | Warning shown to branch manager, trades still allowed |
| ≥ 95% | Red | **All trades BLOCKED** until pool topped up |
| Any (frozen/suspended) | Red | Always blocked regardless of utilization |

### Payback Mode — Complete Lifecycle

**Trigger:** Market resolves → branch owes more than pool balance → deficit recorded

```
Step 1: ACTIVE → PAYBACK (Automatic, immediate)
─────────────────────────────────────────────────
Trigger: branch_settle_resolution detects deficit
What happens:
  - pending_payouts += deficit amount (cumulative — multiple markets can add up)
  - Branch users STILL get paid (Sooq guarantees winner payouts)
  - Branch owes the deficit back
  
During payback:
  ✗ Branch manager CANNOT withdraw
  ✗ Credit chain distribution BLOCKED (can't pay agents)
  ✓ Users can still trade (if solvency gate passes)
  ✓ All positive inflows AUTO-SWEEP toward pending_payouts
  
Sweep mechanics: Every buy that comes in, every exit fee collected,
every admin pool credit → system checks: "is there pending debt?"
If yes → sweep as much as possible toward clearing the debt.
When pending_payouts hits $0 → AUTO-CLEAR back to ACTIVE.

Step 2: PAYBACK → FROZEN (Automatic after 14 days)
─────────────────────────────────────────────────────
Trigger: check_payback_escalation cron (runs via /api/cron/check-errors)
What changes:
  ✗ NEW positions disabled (can't buy new shares)
  ✓ Existing positions can still be sold (users need exit)
  ✓ Sweeping continues
  
This is the "warning shot" — branch has 14 more days.

Step 3: FROZEN → SUSPENDED (Automatic after 30 days total)
───────────────────────────────────────────────────────────
Trigger: Same cron, checks 30-day mark from payback_activated_at
What changes:
  ✗ EVERYTHING blocked
  ✗ No trading, no credits, no withdrawals
  ✓ Admin intervention required to revive
```

### Admin Intervention Tools

**1. Solvency Override** (`admin_override_solvency`)
- Temporarily changes the red threshold (default 95%) to a lower number
- Range: 80-100%, duration: 1-168 hours (max 7 days)
- Requires PIN + mandatory note explaining why
- Use case: Trusted branch temporarily overleveraged, you believe they'll top up
- Auto-expires — after duration, reverts to 95%

**2. Pool Adjustment** (`admin_adjust_branch_pool`)
- Credit or debit the branch pool directly
- If crediting during payback: **payback sweep applies first**
  - Example: Credit $1,000, pending_payouts = $800 → $800 sweeps to clear debt, $200 goes to pool
  - If pending_payouts hits $0 → auto-clears payback mode
- Requires PIN
- Use case: Branch deposits cash offline, you credit their pool

**3. Status Override** (`admin_update_branch_status`)
- Manually set any status: active, payback, frozen, suspended
- Can revive a suspended branch back to active
- Requires PIN
- Use case: Emergency intervention, dispute resolution, manual settlement

**4. Withdrawal Override** (`admin_override_withdrawal`)
- Force-allow a withdrawal even during payback/frozen
- Bypasses reserve lock (but still applies withdrawal fee)
- Requires PIN
- Use case: Branch needs partial withdrawal for operational reasons during payback

### Monitoring Workflow (What to Check Daily)

**Cron runs every 10 minutes (`/api/cron/check-errors`):**
1. `reconcile_branch_solvency()` — recomputes worst_case_total from scratch, flags mismatches >$0.01
2. `check_payback_escalation()` — escalates branches past 14/30 day marks
3. Velocity alerts — flags branches with 5× normal volume (possible manipulation)

**Admin branch list page shows:**
- Every branch with: pool balance, utilization %, status badge, user count, volume, revenue
- Filterable by status (show only payback/frozen branches)
- Click into branch detail for full solvency card, pool ledger, override history

### Counterparty Risk Matrix

| Scenario | Sooq's Exposure | Action |
|----------|----------------|--------|
| Branch healthy, trading normally | Zero (branch pool covers users) | Monitor utilization |
| Branch in payback, clearing naturally | Zero (sweeps clearing debt) | Watch, no action needed |
| Branch frozen 14+ days | Reputational (users stuck) | Contact manager, consider manual intervention |
| Branch suspended 30+ days | Reputational + potential legal | Manual settlement, consider terminating partnership |
| Branch manager disappears | Users can't withdraw from branch | Admin must manually settle — credit users from platform if needed |
| Market resolves, branch pool empty | Users STILL get paid by Sooq | Sooq absorbs the loss, branch owes debt |

**Key insight:** Sooq guarantees payouts to branch users at resolution. If the branch can't pay, Sooq pays and the branch goes into debt (payback mode). This means Sooq has implicit counterparty risk on every branch.

---

## 12. DEEP DIVE: Employee Operational Playbooks

### A. Market Operations — Daily Checklist

**Morning (9 AM):**
- [ ] Check `/admin/alerts` for lopsided markets (price >90% or <10% with volume >$50)
- [ ] Check `/admin/markets` for markets approaching close date — lock if event already happened
- [ ] Review any market creation requests from team/community

**Event-driven (when outcome happens):**
- [ ] Verify outcome from 2+ independent sources
- [ ] Lock market first (blocks new trades) — `/admin/markets/[id]` → Lock
- [ ] Wait 5 minutes (let pending trades settle)
- [ ] Resolve market → `/admin/markets/[id]/resolve`
  - Select YES or NO
  - Enter 6-digit admin PIN
  - **Triple-check: Resolution is IRREVERSIBLE**
- [ ] Verify in `/admin/stats` that payouts processed correctly

**When to VOID instead of resolve:**
- Ambiguous outcome (can't determine YES or NO)
- Market created in error (wrong question, duplicate)
- Legal/compliance issue
- **Warning to team:** Voiding claws back ALL commissions from that market. Agents lose earnings. Only void when necessary.

**Market creation guidelines:**
- Always bilingual (EN + AR) — even if Arabic is rough, it's better than nothing
- Liquidity parameter `b`: 
  - Low volume market: b=100 (sensitive prices, less capital needed)
  - Medium: b=1000 (default, good balance)
  - High volume: b=5000+ (stable prices, needs more capital at risk)
- Set `closes_at` to BEFORE the event (not after) — prevent trading on known outcomes
- Add keywords for search/news matching

### B. Finance/Accounting — Daily Checklist

**Morning (9 AM):**
- [ ] Check `/admin/finance` → Withdrawals tab for pending approvals
- [ ] For each pending withdrawal:
  - Verify user has met wagering requirement
  - Verify user has been deposited 24+ hours
  - Verify user account not flagged for suspicious activity
  - Check withdrawal amount vs. user balance history (unusual large withdrawal?)
  - **APPROVE** or **REJECT** (rejection auto-refunds)
- [ ] Check `/admin/alerts` for balance reconciliation mismatches
  - If `|balance_usd - SUM(transactions)| > $0.01` → investigate immediately
  - This means money appeared/disappeared outside the ledger

**Weekly:**
- [ ] Review `/admin/accounting` → Platform P&L tab
  - Net revenue = all fees collected - all commissions paid
  - AMM P&L = what LMSR earned/lost (can be negative if market moved against AMM)
- [ ] Review Branch revenue tab — ensure branch fees are being collected
- [ ] Review Commission tab — total payout to agents, check for anomalies
- [ ] Export data for bookkeeping if needed

**When admin credit/debit is needed:**
- User reports deposit not credited → verify with payment provider → credit via admin
- Promotional credit for marketing → credit via admin
- Error correction (double-credit, etc.) → debit via admin
- **Always:** Enter clear description, PIN required, max $10K, full audit trail

### C. Support — Daily Checklist

**Check every 2-4 hours:**
- [ ] Open `/admin/support` — check for escalated tickets (AI couldn't handle)
- [ ] Prioritize by: account issues > payment issues > trading questions > general

**Handling tickets:**
- AI auto-responds from help center articles. Most tickets resolve without human.
- When you reply: AI is permanently disabled on that ticket. You own it.
- For account-specific issues: ask user to verify identity via OTP (support sends verification code)
- For payment issues: cross-reference `/admin/finance` deposits/withdrawals with user's claim
- For trading disputes: check `/admin/users/[id]` → trade history and position data

**Telegram support:**
- Same ticket system, different channel
- Telegram messages create/update tickets automatically
- Your replies in admin panel get forwarded to Telegram
- Users can also link their Telegram account for richer experience

### D. Branch Relations — Weekly Checklist

**Weekly review:**
- [ ] Open `/admin/branches` → sort by utilization (highest first)
- [ ] For each yellow/red branch:
  - Contact branch manager (have they deposited more?)
  - Are they aware of solvency issues?
  - Should you override temporarily? (only for trusted, established partners)
- [ ] Check for branches in payback > 7 days (approaching frozen threshold at 14)
- [ ] Review branch revenue vs. platform revenue — are branches growing or shrinking?

**New branch onboarding:**
- [ ] Verify branch manager identity and business legitimacy
- [ ] Create branch in `/admin/branches/create`:
  - Name, unique branch code
  - Assign manager (must have existing user account)
  - Set markup rates (recommend starting at 5% YES, 5% NO)
  - Set branch fee rate (platform's cut, usually 5%)
  - Set exit fee (0.5% default)
  - Choose display mode (trading vs. betting)
  - Enter PIN to confirm
- [ ] Ensure branch manager funds their pool (via admin pool adjustment or their own deposit)
- [ ] Provide branch manager with their dashboard URL: `/b/[code]/`
- [ ] Explain: payback mode, solvency requirements, agent management

**Offboarding a branch:**
- [ ] Set status to SUSPENDED (blocks everything)
- [ ] Settle all pending payouts manually if needed
- [ ] Credit any affected users directly if branch can't pay
- [ ] Document the settlement in system logs

---

## 13. WHAT EACH PERSON NEEDS TO KNOW (Summary Cards)

### Card: V1 Agent (Referral Agent)
> You refer people. They trade. You earn commission on every trade they make.
> - Get 5 referrals who trade → commissions unlock
> - You earn 30-50% of the ~5% platform fee on each trade (so ~1.5-2.5% of trade volume)
> - Your referrals' referrals earn you a smaller cut too (2 layers max)
> - Commission goes to a separate wallet — transfer to portfolio when you want to trade or withdraw
> - If a market gets voided, commissions from that market are taken back

### Card: Branch Manager
> You operate your own prediction market. You're the house.
> - You add markup on top of Sooq's prices (your profit margin)
> - Your users trade against YOUR pool, not Sooq's
> - When your users lose → you profit. When they win → you pay.
> - Keep your pool funded above worst-case. If you can't pay winners → payback mode (14 days to fix)
> - You approve agents who bring users to your branch. Choose wisely: P/L agents share your risk, Commission agents are a fixed cost.
> - Sooq takes a 5% platform fee regardless. The rest is yours.

### Card: Branch Agent
> You bring users to a specific branch. Your deal depends on what the branch manager approved.
> - Commission type: you earn flat % of buy volume. Safe, predictable.
> - P/L type: you share the branch's wins AND losses. Higher upside, real downside.
> - Your referral code links to this specific branch — users sign up under you AND the branch.
> - The branch manager, not Sooq, pays you. They track what they owe and credit you manually.

### Card: Admin / Operations
> You run the platform. Markets, users, money, branches, agents — all under your control.
> - Create markets. Resolve them when outcomes are known. Void if necessary.
> - Approve withdrawals. Monitor deposit reconciliation. Credit/debit with PIN.
> - Watch branch solvency. Intervene before branches hit frozen/suspended.
> - Every sensitive action needs your 6-digit PIN. 5 wrong attempts = 15 min lockout.
> - You can see everything. Branches and agents can only see their own data.
> - Never touch production directly. Everything goes through staging → PR → main.

---

This is the complete operational picture. No code changes needed — this is a reference document for understanding how every role, relationship, and money flow works in the system.
