# Launch Ops Playbook — Manual Phase (No Branches)

> Your daily playbook for the first few weeks. No branches, purely manual ops.
> For the full system reference, see `operations-bible.md`.

---

## Your Admin Panel — What Lives Where

| Route | What It Does | Check Frequency |
|---|---|---|
| `/admin` | **Activity feed** — real-time stream of trades, deposits, withdrawals, signups, errors. Today's stats up top. | **Every session** (home screen) |
| `/admin/alerts` | **Health dashboard** — balance mismatches, both-side alerts, stuck deposits | **Every session** |
| `/admin/finance` | **Pending deposits & withdrawals** — needs your approval | **Multiple times daily** |
| `/admin/withdrawals` | Withdrawal requests — approve/reject | **Multiple times daily** |
| `/admin/markets` | All markets — list, create, manage | Daily |
| `/admin/markets/[id]` | Market detail — positions, trades, AMM state | When investigating |
| `/admin/markets/[id]/resolve` | **Resolve market** — irreversible, PIN-protected | When outcome known |
| `/admin/logs` | System logs with severity filter — acknowledge errors | Daily |
| `/admin/stats` | Platform stats — users, trading, markets, finance, revenue, health | Daily |
| `/admin/accounting` | Revenue breakdown, P&L | Weekly |
| `/admin/users` | User list, search | When investigating |
| `/admin/users/[id]` | User detail — balance, positions, referral chain, admin credit/debit | When investigating |
| `/admin/agents` | Agent list — activation status, commissions | Weekly |
| `/admin/amm` | AMM state — q values, prices, liquidity for all markets | When investigating |
| `/admin/fees` | Fee config — all rates in one place | Rarely |
| `/admin/support` | Support tickets | As needed |
| `/admin/help` | Help center CMS | As needed |

---

## Daily Routine

### Morning (~10 min)

1. **`/admin`** — scan activity feed for anything unusual overnight
   - Red items = errors. Click through to `/admin/logs`
   - Today stats (trades, signups, deposits, active markets) — anything unexpected?

2. **`/admin/alerts`** — your health dashboard
   - Balance mismatches: must be **zero**. Any mismatch = investigate immediately
   - Both-side trading alerts (users holding YES + NO on same market)
   - Stuck/failed deposits

3. **`/admin/finance`** — process pending items
   - **Deposits:** verify proof, approve
   - **Withdrawals:** check balance, wagering req, approve/reject, then actually send the money

4. **`/admin/markets`** — are open markets still relevant? Any close dates approaching?

### Evening (~5 min)

1. Re-check `/admin/finance` for new requests
2. `/admin/logs` — acknowledge any new errors
3. Check Slack for cron alerts

---

## Market Operations

### Creating a Market

`/admin/markets/create` — you need:
- **Question** (EN + AR) — clear, binary, unambiguous
- **Category** — politics, economics, sports, etc.
- **Close date** — set it BEFORE the event (stop trading before outcome known)
- **Image** — optional but helps engagement

AMM auto-initializes at 50/50 with `b=1000` (liquidity parameter).

**Tips:**
- Binary only (YES/NO). Zero ambiguity in resolution criteria
- Write resolution criteria in the description — "Will X happen by Y date according to Z source"
- Start with 3-5 markets, see what gets volume before adding more
- Mix categories — don't go all-politics

### Market Lifecycle

```
OPEN  →  LOCKED  →  RESOLVED
                  ↘  VOIDED
```

| State | Trading | What Happens |
|---|---|---|
| `open` | Yes | Normal trading, prices move with every trade |
| `locked` | No | Frozen — waiting for you to resolve. Use when outcome is imminent |
| `resolved` | No | Winners paid $0.99/share, losers get $0. **Irreversible** |
| `voided` | No | Everyone refunded at cost. Commissions clawed back from agents |

### Resolving a Market (Highest-Stakes Action)

1. `/admin/markets/[id]/resolve`
2. Select outcome (YES or NO)
3. Enter 6-digit PIN
4. Confirm

**Before you click resolve:**
- Is the outcome genuinely confirmed from multiple sources?
- Is there ANY ambiguity? If yes → void instead
- This is **irreversible** — triple-check

What happens automatically:
- Winners get `shares_held x $0.99` credited
- Losers get $0
- 1% resolution fee → platform revenue
- Commissions settled along referral chains
- If zero winners → auto-voids (refunds everyone)

### Voiding a Market

Use when: ambiguous outcome, badly worded market, force majeure, mistake.

**Warning:** Commissions earned from this market get **clawed back** from agents. Only void for legitimate reasons.

### Locking a Market

Use `lock_market` to freeze trading before scheduled close. Example: election results about to drop, you want to stop trades before you verify.

---

## Financial Operations

### Deposits

1. User submits deposit (with proof if manual)
2. Shows up in `/admin/finance`
3. Verify proof matches amount
4. Approve → balance credited via append-only ledger
5. Each deposit has unique `provider_ref` — can't double-credit

### Withdrawals

1. User requests withdrawal in-app
2. Shows up in `/admin/finance` or `/admin/withdrawals`
3. **Check before approving:**
   - Sufficient balance?
   - Wagering requirement met? (deposit bonus users need 2x wager)
   - New account + large withdrawal = extra scrutiny
   - Account not frozen?
4. Approve in admin panel
5. **Actually send them the money** (manual transfer for now)

### Admin Credit/Debit

At `/admin/users/[id]` — for corrections, refunds, promotions.
- Max $10,000 per operation
- PIN-protected (locks after 5 failed attempts, 15 min cooldown)
- Fully audit-logged in `system_logs`

---

## How to Know You're Doing Well

### Health Indicators (Daily)

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Balance mismatches | 0 | 1 → investigate NOW | 2+ → **stop trading** |
| Unacked error logs | 0-2 | 3-5 | 5+ or any `critical` |
| Pending withdrawal age | < 24h | 24-48h | > 48h (bad UX) |
| Pending deposit age | < 12h | 12-24h | > 24h |

### Growth Indicators (Weekly)

| Metric | What Good Looks Like |
|---|---|
| **Daily active traders** | Growing week-over-week. Retention > raw signups |
| **Trades per market per day** | < 10 = boring market. > 50 = engaging |
| **Avg trade size** | Growing = trust building |
| **Signup → first trade conversion** | > 50% = good onboarding. < 25% = UX problem |
| **Deposit → trade ratio** | Users who deposit but don't trade = friction somewhere |
| **Revenue per day** | Visible in `/admin/accounting`. Should grow with volume |

### Revenue Breakdown

| Source | Rate | When Earned |
|---|---|---|
| Explicit trading fee | 0.5% | Every buy and sell |
| AMM spread | ~2-3% | Embedded in LMSR pricing (invisible to user) |
| Resolution fee | 1% | Market resolves (winners get $0.99 not $1.00) |
| Cash-out premium | 0.5% | When users sell positions |
| Dynamic spread | ~0.5% avg | On prices > 65% |
| **Effective round-trip** | **~5%** | Full buy → hold → resolution cycle |

### Commission Health

Agents earn 30-50% of platform revenue on their referrals' trades.

- **Revenue retention** = `(revenue - commissions) / revenue`
- Target: 50-70% retained. Below 50% = commission rates too generous
- Track in `/admin/accounting` and `/admin/agents`

---

## Risk — What Can Go Wrong

### STOP TRADING Immediately If:

| Signal | Where You'll See It | Action |
|---|---|---|
| **Any balance mismatch** | `/admin/alerts`, Slack | Ledger (`SUM(transactions)`) is truth. Fix the `balance_usd` cache. Never edit the ledger. |
| **Negative user balance** | `/admin/alerts` | Locking mechanism failed or bug. Investigate before resuming. |
| **AMM overflow error** | Trade fails: "q values exceed 50*b" | Market hit the math ceiling. Resolve if outcome clear, void if not. |
| **Critical system log** | Slack, `/admin/logs` | Could be webhook crash, DB failure. Find root cause before resuming. |

### Investigate Promptly:

| Signal | What It Means | Action |
|---|---|---|
| **Both-side trading** | User holding YES and NO on same market | Legal, but if they have a referrer → possible commission farming. Check if referrer's commissions are disproportionate. |
| **Rapid trade pattern** | Many trades in short time | Rate limit is 30 sec per market per user. Cross-market rapid trading → watch for wash patterns. |
| **Large first withdrawal** | New account, big withdrawal | Verify deposits were legit. Could be money laundering attempt. |
| **Agent commission spike** | One agent earning way more than tree size justifies | Investigate for self-referral or wash trading. |

### Weekly Risk Review:

| Check | What to Look For |
|---|---|
| **Market concentration** | All volume on 1 market while others dead → diversify |
| **One-sided markets** | Price at 95%+ for days → dead market, resolve or void |
| **User concentration** | 1-2 users = 80% volume → fragile, find more users |
| **Fee vs commission ratio** | Commissions > 60% revenue → adjust rates at `/admin/fees` |
| **Liquidity adequacy** | Check `/admin/amm` — if q values approaching 40x of b, market is getting extreme |

---

## Automated Safety Nets (Already Running)

| Cron Job | Frequency | What It Does |
|---|---|---|
| `/api/cron/check-errors` | Every 10 min | Balance reconciliation, system errors, trade failures. Alerts to Slack. |
| `/api/cron/rank-markets` | Daily | Updates homepage market ordering |
| `/api/cron/fetch-news` | Every 10 min | Fetches relevant news for markets |
| `/api/cron/support-digest` | Periodic | Support ticket summary |

**Requirement:** `SLACK_WEBHOOK_URL` must be set in Vercel env vars or you won't get alerts.

---

## Built-In Safeguards (Don't Touch, Just Know They Exist)

1. **FOR UPDATE locks** — all balance + AMM mutations serialized. No race conditions
2. **Append-only ledger** — `transactions` table is INSERT-only, can't be tampered
3. **Protected columns** — `balance_usd`, `referral_chain`, `agent_level` can't be directly updated
4. **Trade size cap** — max 5% of liquidity parameter per trade
5. **LMSR overflow cap** — hard limit at 50x liquidity parameter
6. **PIN protection** — resolution and credit/debit require your 6-digit PIN
7. **Deposit idempotency** — unique `provider_ref` prevents double-credit
8. **Trade rate limit** — 30 sec between trades on same market per user
9. **Reconciliation cron** — auto-checks `SUM(transactions) = balance_usd` every 10 min

---

## Before First Real User

- [ ] Set your admin PIN (call `admin_set_pin`)
- [ ] `SLACK_WEBHOOK_URL` configured in Vercel
- [ ] Verify crons running in Vercel dashboard
- [ ] Create test markets on staging, trade, resolve — full cycle works
- [ ] Process test deposit + withdrawal end-to-end
- [ ] Review fee rates at `/admin/fees`
- [ ] Set calendar reminders for morning/evening checks
- [ ] Phone notifications on for Slack alerts
- [ ] Bookmark: `/admin`, `/admin/finance`, `/admin/alerts`, `/admin/logs`

---

## Quick Reference

**Every few hours:** `/admin/finance` (deposits & withdrawals)

**Every day:** `/admin` (feed), `/admin/alerts` (health), `/admin/logs` (errors)

**Every week:** `/admin/stats` (growth), `/admin/accounting` (revenue), `/admin/agents` (commissions)

**As needed:** Create markets, resolve markets, credit/debit users, support tickets
