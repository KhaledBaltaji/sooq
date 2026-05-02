# Commission Model — MENA Prediction Market (V3)

> **This is the canonical commission specification.** All other documents referring to
> commission rates, agent tiers, or referral percentages are superseded by this file.
> Last updated: 2026-04-08. Source: V3 technical brief + CEO review + Eng review + Codex review.

## Overview

Multi-level revenue share model. Agents earn a percentage of **total platform revenue**
on their referrals' trades. Platform revenue = explicit fee + AMM spread cost + cash-out premium.

**Key principle:** Commission is a share of ALL platform revenue from a trade, not just the
visible 0.5% explicit fee. This means agents earn meaningful commissions on every trade
their referrals make, including sells/cash-outs.

## V3 Changes from V2

| Aspect | V2 (Pool Model) | V3 (AMM Model) |
|--------|-----------------|----------------|
| Fee basis | 7% platform fee on net exposure | Total platform revenue per trade |
| Commission basis | Net exposure (ABS(YES - NO)) | explicit_fee + amm_spread_cost + cash_out_premium |
| Hedged positions | $0 commission (net = $0) | Commission on every trade (revenue-based) |
| Agent thresholds | 0-9, 10-24, 25-49, 50+ referral count | L1 (default), L2 ($10K+), L3 ($50K+), L4 ($200K+) network volume |
| Commission layers | 3 (direct, indirect, deep) | 2 (direct, indirect) |
| Timing | At market resolution | Real-time at trade time + resolution |

## Agent Levels

Agents are leveled based on their **network volume** — the total USD amount traded
by all users in their referral network (direct + indirect).

| Level | Network Volume Threshold | Description |
|-------|-------------------------|-------------|
| Level 1 | $0 (default)          | Starter     |
| Level 2 | $10,000+              | Active      |
| Level 3 | $50,000+              | Power       |
| Level 4 | $200,000+             | Elite       |

Agent level is recalculated inline by `pay_trade_commissions()` after each trade by a referral.
Level can only go up, never down (ratchet).

## Activation Gate

Agents must have **5 qualified referrals** (referrals who have placed at least one trade)
before commissions are credited to their agent wallet. Until activated:
- Commissions are recorded with status `escrowed` (not credited to balance)
- When the 5th qualified referral makes their first trade, `agent_activated` flips to TRUE
  and all escrowed commissions are released via `_release_escrowed_commissions()`
- Admins can override activation via `toggle_agent_activation_override()`

## Referral Depth Layers

When a trade generates platform revenue, commissions flow UP the referral chain, max 2 layers:

```
Agent A ──referred──> User B ──referred──> User C ──referred──> User D

When User D trades:
  User C earns Layer 1 (direct referrer)    — highest rate
  User B earns Layer 2 (indirect referrer)  — smaller rate
  Agent A earns nothing (beyond 2-layer limit)

Note: referral_chain stores up to 3 entries for network visibility,
but commissions only process the first 2.
```

## Rate Table

All rates are percentages of **total platform revenue** per trade
(explicit_fee + amm_spread_cost + cash_out_premium, typically ~5% of trade volume).

| Tier | Layer 1 (Direct) | Layer 2 (Indirect) | Total | Platform keeps |
|------|-----------------|-------------------|-------|----------------|
| Level 1 (< $10K vol)  | 30% | 5%  | 35% | 65% |
| Level 2 ($10K+ vol)   | 35% | 8%  | 43% | 57% |
| Level 3 ($50K+ vol)   | 40% | 10% | 50% | 50% |
| Level 4 ($200K+ vol)  | 50% | 12% | 62% | 38% |

**Maximum combined cost per trade:** 62% of platform revenue (L4 agent with both layers)
**Platform retains minimum:** 38% of platform revenue at L4

## Commission Calculation

For each trade, `pay_trade_commissions()` runs inline:

```
platform_revenue = trade.explicit_fee + trade.amm_spread_cost + trade.cash_out_premium

For each ancestor in referral_chain (max 2):
  rate = fee_config[fee_type='ngr_commission', level=ancestor.agent_level, depth=layer]
  commission = platform_revenue * rate
  if commission < $0.01: skip (dust threshold)
  if agent activated: credit to agent_balance_usd
  else: escrow until activation
```

Resolution commissions work the same way via `settle_resolution_commissions()`:
```
resolution_revenue = winner.shares_held * resolution_fee_rate (1%)
Same 2-layer loop with fee_type='ngr_resolution_commission'
```

## Worked Example

```
Agent A (Tier 4, $250K vol) referred User B
User B (Tier 2, $15K vol) referred User C
User C (Tier 1, $3K vol) referred User D

User D buys $100 YES at $0.50:
  explicit_fee     = $0.50  (0.5%)
  amm_spread_cost  = $2.50  (~2.5%)
  cash_out_premium = $0.00
  platform_revenue = $3.00

Trade commissions (real-time):
  User C (Layer 1, Tier 1): $3.00 * 30% = $0.90
  User B (Layer 2, Tier 2): $3.00 * 8%  = $0.24
  Agent A: $0 (beyond 2-layer limit)
  ─────────────────────────────────────────
  Total commission: $1.14 (38% of platform revenue)
  Platform keeps: $1.86 from this trade
```

## Commission Timing

- **Trade commissions** are calculated **at trade time** via `pay_trade_commissions()` (called from `execute_trade`)
- **Resolution commissions** are calculated at market resolution via `settle_resolution_commissions()`
- If agent is not activated, commissions are `escrowed` until activation
- If market is **voided**, all commissions (escrowed + credited) are clawed back by `_void_market_internal()`
- Commission amounts use the agent's level **at time of calculation** (snapshot stored in `agent_level_at_time`)

## Database Schema

### referral_commissions table
```sql
id                      UUID PRIMARY KEY
referrer_id             UUID REFERENCES users(id)  -- who earns this commission
trader_id               UUID REFERENCES users(id)  -- whose trades generated it
trade_id                UUID REFERENCES trades(id)
market_id               UUID REFERENCES markets(id)
layer                   INTEGER NOT NULL           -- 1=direct, 2=indirect
agent_level_at_time     INTEGER NOT NULL           -- snapshot of agent tier
platform_revenue_amount DECIMAL(18,6) NOT NULL     -- platform revenue this was calculated on
commission_rate         DECIMAL(5,4) NOT NULL      -- the rate applied (e.g., 0.30 for 30%)
commission_amount       DECIMAL(18,6) NOT NULL     -- the actual dollar amount
revenue_type            VARCHAR NOT NULL           -- 'trade' or 'resolution'
status                  VARCHAR NOT NULL           -- 'escrowed', 'credited', 'voided'
created_at              TIMESTAMP DEFAULT NOW()
```

### fee_config table (commission rows)
```sql
-- 8 rows for ngr_commission (4 tiers * 2 layers)
-- 8 rows for ngr_resolution_commission (4 tiers * 2 layers)
-- Total: 16 commission rows

INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_commission', 1, 1, 0.30, 'Tier 1, Layer 1 (Direct): 30% of platform revenue'),
  ('ngr_commission', 1, 2, 0.05, 'Tier 1, Layer 2 (Indirect): 5% of platform revenue'),
  ('ngr_commission', 2, 1, 0.35, 'Tier 2, Layer 1 (Direct): 35% of platform revenue'),
  ('ngr_commission', 2, 2, 0.08, 'Tier 2, Layer 2 (Indirect): 8% of platform revenue'),
  ('ngr_commission', 3, 1, 0.40, 'Tier 3, Layer 1 (Direct): 40% of platform revenue'),
  ('ngr_commission', 3, 2, 0.10, 'Tier 3, Layer 2 (Indirect): 10% of platform revenue'),
  ('ngr_commission', 4, 1, 0.50, 'Tier 4, Layer 1 (Direct): 50% of platform revenue'),
  ('ngr_commission', 4, 2, 0.12, 'Tier 4, Layer 2 (Indirect): 12% of platform revenue');
-- Same pattern for ngr_resolution_commission
```

## Key Postgres Functions

| Function | Called from | Purpose |
|----------|------------|---------|
| `pay_trade_commissions` | `execute_trade` | Real-time trade commissions (2-layer loop) |
| `settle_resolution_commissions` | `resolve_market` | Resolution fee commissions (2-layer loop) |
| `_credit_commission` | Both above | Shared helper: rate lookup, dust check, escrow/credit |
| `_release_escrowed_commissions` | Activation trigger | Bulk-releases escrowed commissions on activation |
| `_void_market_internal` | `void_market` | Claws back all credited commissions, voids escrowed |
| `toggle_agent_activation_override` | Admin panel | Manual activation override |

## What This Supersedes

- V2 commission model (7% fee on net exposure)
- 3-layer commission model (direct/indirect/deep)
- Any reference to "explicit fee only" as commission basis (now total platform revenue)
- V2 agent level thresholds (referral-count-based: 0-9, 10-24, 25-49, 50+)
- Any reference to "direct referral count" as the basis for agent levels (now network volume)

## Anti-Gaming Safeguards

1. **Revenue-based commission:** Every trade generates platform revenue regardless of direction
2. **Deposit bonus restricted:** $20+ first deposit, non-referred users only
3. **Wagering requirement:** Only buys count toward `total_wagered` (prevents sell-churn to clear bonus)
4. **Admin alert:** "User trading both sides" flagged in risk alerts
5. **Commission escrow:** Escrowed until agent activated (5 qualified referrals)
6. **Void clawback:** All commissions reversed if market voided
7. **auth.uid():** All user-facing RPCs derive user from session, not client params

## Commission Branches (mig 289 + 293)

Commission branches wrap an agent's referral network with a branded URL + dashboard + sub-agent hierarchy, but do NOT change the commission model. They are not a new commission system; they are a new UX surface on top of the existing one.

**Key points:**

- **Sub-agents ride the standard `referral_chain`.** A user signing up via `/b/alice-sports/?agent=[charlie_code]` gets `referred_by = charlie.user_id`. The `handle_referral_signup` trigger fills `referral_chain = [charlie, alice, ...]`. `pay_trade_commissions` walks the same 2 layers as for any retail user — Charlie takes layer 1 at his own tier rate, Alice takes layer 2 at her own tier rate. No new split function.
- **Commission-branch owner is a classic retail agent.** Activation gate (5 qualified referrals), tier progression (L1→L4 by network volume), escrow-until-activated logic all unchanged.
- **Sub-agents are also classic retail agents** once they're in the chain. They accrue their own `network_volume`, progress tiers independently, and can be activated independently of the branch owner.
- **Commission branches add zero incremental rate.** Platform pays the same percentage of revenue regardless of whether the user came via `/r/[code]`, `/b/[slug]`, or `/b/[slug]/?agent=`.
- **Reseller-branch agents are DIFFERENT and unrelated.** `branch_agents` rows on reseller branches operate on the pool (P/L or commission-on-volume against the branch pool), NOT on platform revenue, and do not touch the `referral_chain`. The two systems share the `branch_agents` table but follow different money paths.

**First-touch rule:** a user who already has `referred_by` set keeps their original attribution. Visiting a commission branch URL later never rewrites. Protects long-established agent networks.

**Cross-branch guard:** `/b/alice-sports/?agent=[bob_from_beirut]` is rejected at the signup resolver. Sub-agents are scoped to their branch; can't be used to phish across networks.

See `docs/designs/commission-branch.md` for the full design and `docs/ARCHITECTURE.md §18` for the system overview.

## Release-at-Resolution (mig 296 + 297)

Replaces the prior 30-day monthly calendar lock (mig 250). Same rule applies to ALL agents — retail `/r/[code]`, commission-branch owners, sub-agents.

**State machine:**

| Commission event | Market state at time of event | Agent activated? | Initial status | In agent_balance_usd? |
|---|---|---|---|---|
| Trade-time | open/closed | Yes | `pending` | No |
| Trade-time | resolved (rare) | Yes | `credited` | Yes |
| Resolution-time | resolving (now) | Yes | `credited` | Yes |
| Any | Any | No | `escrowed` | No |

**Transitions (automatic):**
- Market status → `resolved`: a trigger on `markets.status` sweeps all `pending` commissions for that market → `credited`, increments `agent_balance_usd`, writes ledger entries
- Market status → `voided`: trigger sweeps `pending` → `voided`; no balance change (money was never credited). Credited commissions for voided markets follow existing clawback + `agent_pending_microcredits` deficit path
- Agent activation (5 qualified referrals or admin override): `_release_escrowed_commissions` processes each escrowed row based on the market's current status — resolved → credited, open → pending, voided → voided

**Key implications:**
- Commission is available the moment the underlying market resolves — not 30 days later
- Long-running markets mean long wait for that commission (by design — aligned with business lifecycle)
- Void is clean: pending commissions never hit balance, so clawback is trivial
- Clawback deficit only applies to `credited` commissions that got clawed back (existing mig 267 pattern)

## Admin agent-wallet adjustments (mig 298)

Admin can credit or debit a user's `agent_balance_usd` via `admin_adjust_agent_balance(p_user_id, p_amount, p_description, p_pin)`. Mirrors `admin_adjust_balance` but targets the commission wallet instead of the trading wallet. PIN-protected, $10,000 cap, audit trail to both `transactions` and `system_logs`, rejects frozen users and overdrafts.

Used for bug recovery, comp'ed commissions, and dispute resolution — not for routine commission flow (which is fully automatic).
