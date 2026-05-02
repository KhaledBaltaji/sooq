# Technical Brief V2: MENA Prediction Market Platform
# Updated with all founder decisions

---

## What We're Building

A prediction market platform targeting the MENA region (launching in Lebanon). Users predict outcomes of real-world events (political, economic, social) by placing bets with real money. Winners split the losers' money. The platform takes a 7% fee on every resolved market.

**This is NOT a crypto platform in look or feel.** It should feel like a modern fintech app — think Revolut or Cash App. No blockchain jargon, no wallet addresses visible, no crypto aesthetics. Users see "$" everywhere. The fact that deposits happen via USDT/USDC is a payment method detail, not the product identity.

**Platform name:** TBD (founder deciding within 1 week). Use placeholder "Platform" in code, make name easily swappable.

---

## Business Model: Pool-Based Prediction Market (Phase 1)

### How It Works

1. Admin creates a market with a YES/NO question, expiry date, and resolution source
2. Users deposit funds (USDT/USDC via 3pay) — converted to a single USD balance
3. Users bet on YES or NO — money goes into that side's pool
4. Market expires — admin confirms outcome using the stated resolution source
5. Platform takes 7% off the total pot — payouts processed instantly, decision is final
6. Remaining pot distributed to winning side using Option B payout (see below)
7. Losing side gets nothing

### Payout Model: Option B — Locked Payout at Time of Bet

Each bet locks in its payout ratio at the moment it's placed based on current pool sizes. Early bettors get better ratios than late bettors.

**Example:**
- Market opens Monday. YES pool: $200 (seed), NO pool: $200 (seed)
- User A bets $50 on YES Monday. Pool ratio at that moment: YES $250, NO $200. Implied payout ratio for YES = ($250 + $200) / $250 = 1.80x
- User B bets $50 on YES Thursday. Pool now: YES $2,000, NO $1,500. Implied payout ratio = ($2,000 + $1,500) / $2,000 = 1.75x — worse than User A got
- Market resolves YES. After 7% fee:
  - User A's $50 × 1.80 = $90 (locked at Monday's ratio, adjusted for 7% fee)
  - User B's $50 × 1.75 = $87.50 (locked at Thursday's ratio, adjusted for 7% fee)

**Implementation note:** Each bet record must store the payout_ratio_at_placement. On resolution, each winning bet is paid out individually based on its locked ratio. The 7% fee is deducted proportionally. If total calculated payouts exceed the actual pot (due to rounding/edge cases), scale all payouts down proportionally.

**Edge case — payout exceeds pot:** Because ratios are locked at different times, the sum of all locked payouts could theoretically exceed the actual pot after the 7% fee. In this case, calculate all individual payouts, sum them, and if the sum exceeds (total_pot × 0.93), apply a scaling factor: actual_payout = locked_payout × (available_pot / sum_of_all_locked_payouts). This ensures the platform always takes its 7% and never pays out more than exists.

### Multiple Bets

- Users CAN place multiple bets on the SAME SIDE of a market (increase stake over time)
- Each additional bet gets its OWN locked payout ratio at time of placement
- Users CANNOT bet on BOTH sides of the same market — backend must enforce this
- Users CAN bet on multiple different markets simultaneously

---

## Currency & Pool Structure

**Single USD Pool.** All deposits (USDT, USDC, future payment methods) are converted to a unified USD balance. Users see "$" only. Pools are denominated in USD. No separate pools per currency.

**Internal tracking:** The system tracks which currency was deposited for withdrawal routing purposes, but the user-facing balance is always one number in "$".

---

## Payment Integration: 3pay

The platform integrates with 3pay (founder's existing payment infrastructure) for all deposit and withdrawal processing.

### Deposit Flow
- User selects amount ($10, $25, $50, $100 or custom)
- User selects payment method: USDT or USDC (more methods added later)
- 3pay handles the payment processing
- Upon confirmation, user's USD balance is credited
- **Deposit fee:** Dynamic, configurable from admin dashboard. Start at 0% to encourage deposits. Fee deducted from credited amount.

### Withdrawal Flow
- User requests withdrawal — enters amount and destination
- **All withdrawals require manual team approval at launch**
- Admin sees withdrawal queue in dashboard — approve or reject
- **Withdrawal fee:** Dynamic, configurable from admin. Flat fee + percentage, deducted from withdrawal amount. Start with $1 flat + 1% with a $1 minimum total fee.
- Future: Add auto-approve for small amounts (<$50) once operations are stable
- Withdrawal fees are configurable per currency and per chain from admin dashboard

### Fee Configuration (Admin Dashboard)
```
deposit_fee_percentage:  DECIMAL  (default 0%)
withdrawal_fee_flat:     DECIMAL  (default $1.00)
withdrawal_fee_pct:      DECIMAL  (default 1%)
withdrawal_fee_min:      DECIMAL  (default $1.00)
```
All fees are dynamic and adjustable without code changes.

---

## Tech Stack

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS + shadcn/ui
- **Animations:** Framer Motion (subtle, purposeful)
- **State:** Zustand or React Context
- **Real-time:** Socket.io or Supabase Realtime (live pool updates)
- **Language:** TypeScript throughout
- **Mobile-first:** 90%+ of MENA users are on phones
- **RTL support:** Full right-to-left for Arabic
- **Dark mode:** Default

### Backend
- **Runtime:** Node.js with Express or Fastify
- **Database:** PostgreSQL (via Supabase or standalone)
- **Auth:** Phone number + OTP (Twilio or similar)
- **Real-time:** WebSocket for live pool size updates
- **Task Queue:** Bull/BullMQ for withdrawal processing, commission calculations
- **Payment:** 3pay API integration

### Hosting
- **App:** Vercel (frontend) + Railway/Render/VPS (backend)
- **Database:** Supabase or managed PostgreSQL
- **CDN/Security:** Cloudflare

---

## Database Schema

### users
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
phone_number        VARCHAR UNIQUE NOT NULL
phone_verified      BOOLEAN DEFAULT FALSE
display_name        VARCHAR -- optional, users can be anonymous
balance_usd         DECIMAL(18,6) DEFAULT 0 -- single unified USD balance
referral_code       VARCHAR UNIQUE NOT NULL
referred_by         UUID REFERENCES users(id)
agent_tier          INTEGER DEFAULT 0 -- 0=regular, 1=10+refs, 2=50+refs, 3=200+refs
is_frozen           BOOLEAN DEFAULT FALSE -- admin can freeze suspicious accounts
created_at          TIMESTAMP DEFAULT NOW()
last_active_at      TIMESTAMP
```

### markets
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
question_en         TEXT NOT NULL
question_ar         TEXT NOT NULL
description_en      TEXT
description_ar      TEXT
resolution_source   TEXT NOT NULL -- e.g. "Central Bank of Lebanon official rate at 5pm Friday"
status              VARCHAR NOT NULL DEFAULT 'open'
                    -- ENUM: 'open', 'closed', 'resolved_yes', 'resolved_no', 'cancelled', 'void'
opens_at            TIMESTAMP NOT NULL
closes_at           TIMESTAMP NOT NULL -- when betting stops
resolves_at         TIMESTAMP NOT NULL -- when outcome is determined
total_yes_pool      DECIMAL(18,6) DEFAULT 0
total_no_pool       DECIMAL(18,6) DEFAULT 0
total_bettors_yes   INTEGER DEFAULT 0
total_bettors_no    INTEGER DEFAULT 0
min_bet             DECIMAL(18,6) DEFAULT 5
platform_fee_pct    DECIMAL(5,2) DEFAULT 7
seed_amount_yes     DECIMAL(18,6) DEFAULT 0
seed_amount_no      DECIMAL(18,6) DEFAULT 0
resolved_by         UUID REFERENCES users(id)
resolution_proof    TEXT -- link or description of evidence
auto_close_if_empty BOOLEAN DEFAULT TRUE -- close if <$100 non-seed bets after 48hrs
created_at          TIMESTAMP DEFAULT NOW()
```

### bets
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id             UUID REFERENCES users(id) NOT NULL
market_id           UUID REFERENCES markets(id) NOT NULL
side                VARCHAR NOT NULL -- 'yes' or 'no'
amount              DECIMAL(18,6) NOT NULL
payout_ratio        DECIMAL(18,6) NOT NULL -- locked at time of bet placement
potential_payout    DECIMAL(18,6) NOT NULL -- amount × payout_ratio
actual_payout       DECIMAL(18,6) -- filled after resolution (NULL until then)
created_at          TIMESTAMP DEFAULT NOW()

INDEX (market_id, user_id)
INDEX (user_id, created_at)
CONSTRAINT same_side CHECK -- user cannot bet both sides of same market
```

### deposits
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id             UUID REFERENCES users(id) NOT NULL
amount_crypto       DECIMAL(18,6) NOT NULL -- amount in original currency
amount_usd          DECIMAL(18,6) NOT NULL -- credited USD amount after fee
currency            VARCHAR NOT NULL -- 'usdt', 'usdc'
chain               VARCHAR -- 'tron', 'ethereum', 'bsc' etc.
fee_amount          DECIMAL(18,6) DEFAULT 0
threepay_ref        VARCHAR -- 3pay transaction reference
status              VARCHAR DEFAULT 'pending' -- 'pending', 'confirmed', 'failed'
created_at          TIMESTAMP DEFAULT NOW()
confirmed_at        TIMESTAMP
```

### withdrawals
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id             UUID REFERENCES users(id) NOT NULL
amount_requested    DECIMAL(18,6) NOT NULL
fee_amount          DECIMAL(18,6) NOT NULL
amount_net          DECIMAL(18,6) NOT NULL -- amount_requested - fee_amount
currency            VARCHAR NOT NULL DEFAULT 'usdt'
chain               VARCHAR
destination_address VARCHAR NOT NULL
threepay_ref        VARCHAR
status              VARCHAR DEFAULT 'pending'
                    -- 'pending', 'approved', 'processing', 'completed', 'rejected'
reviewed_by         UUID REFERENCES users(id)
review_note         TEXT
created_at          TIMESTAMP DEFAULT NOW()
reviewed_at         TIMESTAMP
completed_at        TIMESTAMP
```

### referral_commissions
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
referrer_id         UUID REFERENCES users(id) NOT NULL
referred_user_id    UUID REFERENCES users(id) NOT NULL
bet_id              UUID REFERENCES bets(id) NOT NULL
market_id           UUID REFERENCES markets(id) NOT NULL
commission_rate     DECIMAL(5,2) NOT NULL -- 20-35% based on agent tier
commission_amount   DECIMAL(18,6) NOT NULL
status              VARCHAR DEFAULT 'credited' -- 'credited', 'paid'
created_at          TIMESTAMP DEFAULT NOW()
```

### platform_revenue
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
market_id           UUID REFERENCES markets(id) NOT NULL
total_pot           DECIMAL(18,6) NOT NULL
fee_amount          DECIMAL(18,6) NOT NULL -- 7% of total pot
total_commissions   DECIMAL(18,6) NOT NULL -- sum paid to agents
net_revenue         DECIMAL(18,6) NOT NULL -- fee_amount - total_commissions
created_at          TIMESTAMP DEFAULT NOW()
```

### fee_config
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
fee_type            VARCHAR NOT NULL -- 'deposit', 'withdrawal'
fee_flat            DECIMAL(18,6) DEFAULT 0
fee_percentage      DECIMAL(5,2) DEFAULT 0
fee_minimum         DECIMAL(18,6) DEFAULT 0
currency            VARCHAR DEFAULT 'all'
is_active           BOOLEAN DEFAULT TRUE
updated_at          TIMESTAMP DEFAULT NOW()
updated_by          UUID REFERENCES users(id)
```

---

## Dynamic Market Algorithms

### Dynamic Max Bet

No manual configuration needed. Algorithm auto-adjusts based on pool size, time remaining, and pool balance.

```
time_factor:
  if time_remaining > 50%:  1.0
  if time_remaining > 25%:  0.5
  if time_remaining > 10%:  0.25
  else:                     0.10

balance_factor:
  if betting_heavy_side AND heavy_side > 65%:  0.5
  if betting_light_side AND heavy_side > 65%:  1.5
  else:                                         1.0

max_bet = MAX($100, 20% of total_pool × time_factor × balance_factor)
```

**Effect:**
- Early in market lifecycle: generous limits encourage volume
- Late in market lifecycle: limits shrink to prevent last-minute manipulation
- Lopsided pools: heavy side restricted, light side encouraged to self-balance

### Dynamic Betting Window

- Betting closes automatically based on `closes_at` timestamp
- Last 2 hours before close: only bets on the lighter side accepted
- Last 30 minutes before close: no new bets accepted
- All times displayed in user's local timezone

### Automatic Dead Market Detection

- If a market has less than $100 in non-seed bets after 48 hours from opening
- System automatically cancels the market
- All bets refunded in full (no fee taken)
- Market silently removed from the app
- Admin notified via dashboard alert

### Empty Side Rule

- If a market resolves and one side has ZERO bets (excluding seed):
- All bets refunded in full — no fee taken
- Market marked as 'void'
- This protects users from losing 7% when there was no real market

---

## User-Facing Web App — Screens

### 1. Home / Active Markets
- Active market(s) — maximum 2-3 at launch
- For each market:
  - Question in large text (Arabic primary, English toggle)
  - Countdown timer (user's local timezone)
  - YES pool total + number of bettors
  - NO pool total + number of bettors
  - Visual bar showing YES vs NO ratio
  - "Your potential payout" calculator — updates as user types amount
  - Preset bet buttons: $5, $10, $25, $50
  - Custom amount input
  - One-tap "Bet YES" or "Bet NO" button
- Recently resolved markets with outcomes
- Live activity feed: "User #4521 bet $25 on YES" (anonymous with user IDs)

**UX rules:**
- Three taps maximum from opening app to placing a bet
- Potential payout number is the HERO element — biggest number on screen
- Pool sizes update in real-time via WebSocket
- Social proof: "312 people have predicted on this market"

### 2. Authentication
- Phone number input → OTP verification → Done
- NO email. NO password. NO username required.
- Support +961 (Lebanon) first. Expand to +20 (Egypt), +971 (UAE) later.
- Optional display name (users can remain anonymous)

### 3. Deposit Screen
- "Add funds to your account" — clean, fintech feel
- Amount presets: $10, $25, $50, $100 (with $25 default/highlighted)
- Payment method: USDT, USDC (label as payment methods, not crypto)
- 3pay handles the payment flow
- "Waiting for deposit..." status with auto-detection
- Fee displayed clearly before confirmation (if any)
- NO wallet addresses shown prominently
- NO blockchain jargon

### 4. Portfolio / My Bets
- Active bets with current pool status and locked payout ratio
- Historical bets with outcomes (won/lost)
- Win/loss record
- Total profit/loss
- Personal prediction accuracy percentage

### 5. Leaderboard
- Top predictors by accuracy
- Top predictors by profit
- Weekly leaderboard (top predictor gets $50 free bet)
- User's own ranking highlighted
- Anonymous display: "User #4521" with optional display names

### 6. Referral Hub
- Unique referral link (one-tap copy, one-tap WhatsApp share)
- Number of people referred (no names shown — referral connection hidden from referred user)
- Commission earned: lifetime + this month
- Real-time earnings: "You earned $2.10 from a referred user's bet!"
- Tier progress: "Refer 7 more people to reach Agent Tier 2 (30% commission)"
- Agent dashboard (visible at 10+ referrals):
  - Active referred users (anonymous IDs)
  - Volume generated
  - Commission breakdown
  - Payout history

### 7. Wallet / Balance
- Current balance in "$"
- Deposit button
- Withdraw button
- Transaction history (deposits, withdrawals, bets, winnings, commissions)
- Withdrawal: Enter amount → Enter destination → See fee → Confirm → Enters approval queue

### 8. Market Detail (expanded)
- Full question + description (AR + EN)
- Resolution criteria clearly stated
- Resolution source linked
- Pool growth chart over time
- User's position in this market (with locked payout ratio shown)
- Share button → shareable card for WhatsApp/Telegram

### 9. Notifications
- "New market: Will ceasefire talks resume?"
- "Your market resolves in 2 hours — 68% say NO"
- "You won $35.50!"
- "A referred user just signed up!"
- "You earned $1.20 in commission"

---

## Admin Dashboard

### 1. Treasury Overview
- Total USD held (3pay balance)
- Total user balances (sum of all accounts)
- Reserve ratio (must be >= 100%)
- Pending withdrawals total
- Daily inflows vs outflows chart
- Fee revenue today/this week/this month

### 2. Market Management
- **Create market:**
  - Question (EN + AR)
  - Description (EN + AR)
  - Resolution source
  - Open/close/resolve timestamps
  - Min bet
  - Seed amounts (YES and NO)
  
- **Active markets dashboard:**
  - YES/NO pool sizes
  - Balance ratio with color coding (green <60/40, yellow <70/30, red >70/30)
  - Bettors per side
  - Time remaining
  - Dynamic max bet currently in effect
  
- **Resolve market:**
  - Select YES or NO outcome
  - Enter proof/evidence
  - Confirm → instant payout calculation and distribution (decision is FINAL)
  
- **Cancel market:** Refunds all bets, no fee taken (emergency only)

### 3. Withdrawal Queue
- List of pending withdrawal requests
- Per request: user, amount, fee, destination, account history
- Approve / Reject buttons with note field
- Large withdrawal flag (configurable threshold)

### 4. User Management
- User list with search
- Per user: balance, bet history, deposit/withdrawal history, referral count
- Freeze/unfreeze accounts
- Manual balance adjustments (for disputes, bonuses)
- Flag: multiple accounts from same IP/device

### 5. Financial Reports
- Daily/weekly/monthly P&L
- Revenue per market
- Total commissions owed vs paid
- Deposit fee revenue
- Withdrawal fee revenue
- Net revenue after all costs

### 6. Agent Management
- Agent list with tier, user count, volume, commission
- Manually promote/demote tiers
- Commission payout tracking

### 7. Risk Alerts
- Market with >70/30 balance ratio
- Large single bets (>10% of pool)
- Multiple accounts from same IP/device
- Unusual withdrawal patterns
- Dead markets approaching 48hr threshold

### 8. Fee Configuration
- Deposit fee percentage (default 0%)
- Withdrawal fee flat + percentage + minimum
- Per currency/chain if needed
- Changes take effect immediately, no code deploy needed

---

## Referral & Agent System

### Mechanics
- Every user gets a unique referral link at signup
- Referred user CANNOT see who referred them (hidden connection)
- Commission starts from the referred user's very first bet
- Commission = percentage of platform's 7% fee on every bet
- Commission is LIFETIME

### Agent Tiers
| Tier | Referred Users | Commission Rate |
|------|---------------|-----------------|
| Regular | 0-9 | 20% of 7% fee |
| Tier 1 | 10-49 | 25% of 7% fee |
| Tier 2 | 50-199 | 30% of 7% fee |
| Tier 3 | 200+ | 35% of 7% fee |

### Commission Calculation
- Agent Tier 2 referred User B
- User B bets $100
- Platform fee: $7 (7%)
- Agent commission: $7 × 30% = $2.10
- Credited to agent's balance instantly

---

## Anti-Manipulation Rules

1. **Dynamic max bet** — algorithmic, based on pool size, time, and balance (see above)
2. **Time-based restrictions** — last 2hrs: light side only. Last 30min: no new bets.
3. **Same-side only** — users cannot bet both YES and NO on same market
4. **Rate limiting** — max 1 bet per user per market per minute
5. **Single account** — one account per phone number. Flag same IP/device.
6. **Withdrawal delay** — first withdrawal from new account requires 24hr wait
7. **Wagering requirements** — bonus/promo funds must be wagered 2x before withdrawal
8. **Anonymous betting** — activity feed shows "User #4521 bet $25 on YES" — no real names

---

## Localization

### Language
- Arabic (Lebanese dialect casual, MSA formal) = PRIMARY
- English = SECONDARY
- Full RTL support for Arabic
- Toggle accessible from every screen
- Market questions in BOTH languages

### Currency Display
- All amounts shown as "$" — no "USDT" or "USDC" labels in normal UI
- Payment method labels only during deposit/withdrawal flow
- Single unified USD balance per user

### Timezone
- All market deadlines displayed in user's local timezone
- Stored as UTC in database
- Converted client-side

### Cultural
- Use "prediction" and "forecast" language — never "gambling" or "betting" in public copy
- WhatsApp-optimized sharing (most used app in Lebanon)
- Dark mode default
- Respect Ramadan considerations for market themes

---

## Security

### Application
- Rate limiting on all API endpoints
- Input validation on all user inputs
- SQL injection protection (parameterized queries)
- XSS protection
- HTTPS everywhere
- OTP rate limiting (max 5 attempts per phone per hour)
- JWT with short expiry + refresh tokens

### Data
- Encrypt phone numbers at rest
- Log all admin actions with audit trail
- All financial transactions logged immutably
- Daily database backups minimum

### Anti-Fraud
- Multiple accounts detection (IP/device fingerprinting)
- Coordinated betting pattern detection
- Suspicious withdrawal pattern flagging
- Manual review queue for flagged activity

---

## Phase 2 Preview: Exchange Layer (Month 3-4)

Built ONLY after reaching 2,000+ active users with validated product-market fit.

- Each market gets tradeable YES/NO contracts priced $0.00-$1.00
- Users buy and sell anytime before resolution
- YES resolves to $1.00, NO resolves to $0.00
- 2% fee on every trade
- Simple mode (pool) remains for casual users
- Trade mode (exchange) for active traders
- Multiplies volume per user 5-10x

**Architecture requirement:** Phase 1 code must be clean enough to add exchange layer without rewriting core. Separate betting logic from market logic from payment logic.

---

## MVP Scope

### Must Have — Week 1-2
- [ ] Phone OTP authentication
- [ ] User account with unified USD balance
- [ ] 3pay deposit integration
- [ ] Market display with YES/NO pools + real-time updates
- [ ] Bet placement with locked payout ratios (Option B)
- [ ] Dynamic max bet algorithm
- [ ] Market resolution + instant automatic payout
- [ ] Withdrawal request queue (manual approval)
- [ ] Dynamic deposit/withdrawal fee system
- [ ] Referral link generation + commission tracking
- [ ] Admin: create market, resolve market, treasury view, withdrawal queue
- [ ] Arabic + English UI with RTL support
- [ ] Dark mode default
- [ ] Mobile-first responsive design

### Should Have — Week 2-3
- [ ] Leaderboard
- [ ] Push notifications (expiry alerts, win alerts, referral alerts)
- [ ] WhatsApp share button with market preview card
- [ ] Agent dashboard with commission tracking
- [ ] Deposit bonus system ($5 free on first $20 deposit, 2x wagering)
- [ ] Risk alerts in admin dashboard
- [ ] Automatic dead market detection + cancellation
- [ ] Anonymous activity feed ("User #4521 bet $25 on YES")
- [ ] Dynamic betting window (last 2hrs light side only, last 30min closed)

### Nice to Have — Month 2+
- [ ] Prediction history and accuracy stats
- [ ] AI-generated market share cards
- [ ] Community market voting
- [ ] Advanced admin analytics
- [ ] Recurring market templates (weekly dollar rate)
- [ ] API for future bot/exchange integration
- [ ] Auto-approve small withdrawals

---

## Key Metrics — Track from Day 1

- Daily Active Users (DAU)
- Bets placed per day
- Average bet size
- Total daily volume
- Pool balance ratios per market
- Referral conversion rate (signups / link clicks)
- Deposit-to-first-bet conversion rate
- Repeat bet rate (% of users who bet on 2+ markets)
- Average revenue per user per month
- Treasury health (total held / total user balances)
- Agent count and volume per agent
- Commission as % of gross revenue

---

## Design Direction

### DO
- Modern fintech feel (Revolut, Cash App)
- Clean, minimal, high contrast
- Dark mode default
- Large touch targets for mobile
- Beautiful Arabic typography — not an afterthought
- Bold numbers for amounts and payouts (hero elements)
- Subtle animations on bet placement and resolution
- Green/red for YES/NO and win/loss

### DO NOT
- Trading terminal aesthetics
- Crypto/blockchain imagery or jargon
- Complex charts or order books (Phase 1)
- Dense information — each screen has ONE primary action
- Corporate/enterprise feel — this should feel exciting and alive
- Any reference to "gambling" or "betting" in user-facing copy
