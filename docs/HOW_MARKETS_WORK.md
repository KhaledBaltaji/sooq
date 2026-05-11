# How Sooq Speed markets work

Plain-English guide for the founder. No code. No jargon. Skim time: 10 minutes.

---

## 1. What a "market" is

Every round on Sooq Speed is one question:

> **"Will BTC be higher or lower than $X in N minutes?"**

- `$X` is the **target** (also called the **strike**). It's the live BTC price at the moment the round opens.
- `N minutes` is the **duration**. Today we have 5m and 1m markets on BTC.
- The user picks **UP** or **DOWN** and stakes a dollar amount.
- When the round closes, BTC's price is read from Binance. UP wins if higher, DOWN wins if lower.

That's the whole product. Everything else is dials.

---

## 2. The lifecycle of a single round

```
   ┌─ 0s ─────────────────────── 60s / 300s ─┐
   │                                         │
   ▼                                         ▼
[OPEN]  ─────[users trade]───────►   [CLOSES]  ───►  [RESOLVED]
   │                                              │
   ▼                                              ▼
target locked                              winners paid
                                           losers lose
```

1. **Open** — a new market is created every minute (1m) or every 5 minutes (5m). At the moment of opening, we snapshot the current BTC price as the target.
2. **Trade** — users place UP or DOWN bets at the live odds. Each bet is locked in at the price the user accepted.
3. **Close** — at exactly the close time, we read BTC's price one more time.
4. **Resolve** — if BTC is above target, UP wins. If below, DOWN wins. Winners get paid out at the odds they locked in. Losers lose their stake.

---

## 3. How prices and payouts work

Each side of the market shows a **percentage**. That's the price.

| You see | Means | If you stake $10 and win |
|---|---|---|
| UP 50% | "Buying UP costs 50¢ per dollar of payout" | You win **$20** ($10 / 0.50) |
| UP 25% | "Buying UP costs 25¢ per dollar of payout" | You win **$40** ($10 / 0.25) |
| UP 80% | "Buying UP costs 80¢ per dollar of payout" | You win **$12.50** ($10 / 0.80) |

**The simple rule:** lower percentage = bigger payout if you win = less likely. Higher percentage = smaller payout = more likely.

UP price + DOWN price always **adds up to a bit more than 100%**. That extra slice is the **house edge** (also called the spread). On BTC-5m it's 5%. On BTC-1m it's 8%.

Example at 50/50 fair odds with 5% spread:
- UP shows 52.5%
- DOWN shows 52.5%
- Total: 105%
- That extra 5% is your edge per trade.

---

## 4. Cashout — selling your position back early

A user who already opened a position can sell it back to the house before close. They get a "Cash Out" button that shows the current resale value.

- If BTC moved in their favor → cashout is more than their stake (they profit).
- If BTC moved against them → cashout is less than their stake (they cut loss).
- The house keeps a small cashout margin on top of the live odds.

**Direction guarantee** (locked-in rule): if the current price favors the user's side, the cashout is always greater than their stake. They can't be tricked into a losing cashout when they're actually winning.

---

## 5. The dials you control

Open `/admin/markets-config` to edit any of these. Two rows: **BTC-5m** and **BTC-1m**. (GOLD rows are there but disabled.)

### Money limits — the four you'll touch most

| Dial | What it does | Current BTC-5m | Current BTC-1m |
|---|---|---|---|
| **Stake min** | Smallest single bet allowed | $1 | $1 |
| **Stake max** | Largest single bet allowed | $25 | $25 |
| **Payout max** | Biggest possible win from one ticket | $2,500 | $250 |
| **Per-user-per-side cap** | Total a user can have on ONE side of ONE market | $200 | $100 |

Raise these to let bigger bets through. Lower them to protect against whales draining the book.

### Risk dials

| Dial | What it does | Current BTC-5m | Current BTC-1m |
|---|---|---|---|
| **Per-side pool limit** | Max % of house collateral exposed on one side of one market | 100% | 10% |
| **Velocity limit** | Max bets per user per minute | 30 | 30 |
| **Daily handle alert** | Threshold for "this user is going hard" telemetry | $5,000 | $5,000 |

### Pricing dials

| Dial | What it does | Current BTC-5m | Current BTC-1m |
|---|---|---|---|
| **Spread %** | House edge baked into the price | 5% | 8% |
| **Soft-block threshold** | Above this odds, the buy button greys out (extreme bets blocked) | 97% (after mig 0058) | 97% |
| **Late-window multipliers** | Spread widens in last 60s and last 30s before close | 1.2× / 1.4× | 1.2× / 1.4× |

### Cashout dials

| Dial | What it does | Current |
|---|---|---|
| **Winning cashout margin** | House edge on winning cashouts | 2.5% |
| **Losing cashout margin** | House edge on losing cashouts | 8% |
| **Cashout reject window** | Cashout blocked in last N seconds | 3-10s |

### The big switches

- **Master switch** (`speed_markets_enabled`) — turns ALL speed markets on/off.
- **1m markets** (`speed_1m_markets_enabled`) — toggles 1m specifically.
- **Per-market enabled** — toggles BTC-5m or BTC-1m on its own.
- **Cashout enabled** — turn cashout on/off across the platform.

---

## 6. What can go wrong — the edge cases

### A. The market closes EXACTLY at the target price

Called a **push** or **tie**. Today: both sides get a full refund. Nobody wins, nobody loses.

After flipping the new tie-rule (mig 0055, ready but waiting on disclosure): the side with more money on it loses instead. House keeps the spread.

**Why it matters:** on BTC-1m markets, this happens ~18% of the time because BTC often doesn't move a full cent in 60 seconds. That's a lot of refund volume the tie rule converts to revenue.

### B. BTC spikes weirdly at close (a "wick")

If BTC jumps more than 0.15% in 5 seconds right at close, we don't trust that price. We use a **median of the last 30 ticks** instead. Protects against pump-and-dump attempts targeting our settlement.

If we can't compute a median (no recent data), the market is **voided** — everyone gets a refund.

### C. The oracle stops working

If our BTC price feed is more than 2 seconds stale, the system refuses to open new markets and refuses to settle expiring ones. The cron retries every 5 seconds. Once the feed recovers, everything resumes. Markets that expired during the outage may be voided.

### D. Soft-block hits the user

When one side's odds get above 97% (basically already-decided), the trade button greys out. The user sees "Odds too one-sided here — try the other side." This stops users from betting at terrible payouts.

### E. Late-window block

In the last 10 seconds before close (3 seconds for 1m), no new trades. Server is too busy computing settlement, and the odds at that point are basically fixed anyway.

### F. Near-decided block

In the last 30 seconds + odds heavily skewed (>80% or <20%), additional block. Mirrors the soft-block idea but window-specific.

### G. NGR breaker

If the house loses more than $500 in net revenue on a single UTC day, the platform pauses new trading. Resets at midnight UTC. Protects against runaway losses if a model bug appears.

### H. Position caps

A single user can't have more than $200 on UP on a single market (BTC-5m) or $100 (BTC-1m). And one side of a single market can't have more than 25% of the house's collateral pool. Both protect against the book getting too lopsided.

### I. Pricing matrix (currently ON, mostly dormant)

A separate system that adjusts odds in extreme zones based on calibration data. Currently fires occasionally. Adds 5-15 percentage points to the spread when active. Today the client now sees these adjustments directly (via the /quote endpoint) so users no longer see "to win $167" then get $50.

### J. CLV throttle (currently ON, affects sharp users)

If a user has been beating the model over 50+ settled trades, the system quietly shades their prices worse. Right now this is shading exactly one test user. Once the /quote endpoint hook ships, those users will see their actual (shaded) price in the trade panel.

---

## 7. Money flow — where does revenue come from?

For every $1,000 that flows through the platform in a day:

```
$1,000  STAKES IN (everyone's bets pooled together)
−$X     WINNER PAYOUTS (winners receive stake / their odds)
−$Y     CASHOUT PAYOUTS (early exits, marked down)
−$Z     REFUNDS (push refunds, voided markets)
= $NET  House revenue (NGR — Net Gaming Revenue)
```

For typical balanced trading the house keeps roughly **5-10% of stakes** as net revenue. Higher when:
- Trades are in the late window (spread escalation kicks in)
- Cashouts trigger margins
- Soft-block keeps bets out of the worst-EV zones
- Tie-rule (when on) converts pushes to losses

Lower when:
- Book is heavily lopsided and the heavy side wins
- A user with positive expected value isn't shaded enough
- A wick voids a market

---

## 8. How to safely change a limit

1. Go to `/admin/markets-config` (superadmin only).
2. Pick a market (BTC-5m or BTC-1m).
3. Edit the dial.
4. Click Save → confirm "YES" prompt for big changes.
5. Watch the next 5 markets and confirm behavior is what you expected.

**Things that take effect immediately:**
- Stake / payout / cap limits (next trade)
- Spread (next quote, ~3 seconds)
- Late-window multipliers (next late window crossing)

**Things that snapshot at market open (only affect FUTURE markets, not current ones):**
- Tie-loser rule on/off
- Master enabled toggle (for new rolls only)

**Things to be especially careful with:**
- Lowering payout max — might trip on positions already in flight
- Raising stake max — might attract bigger trades before you've stress-tested liability
- Toggling `enabled` from OFF to ON — cascades: also flips the asset gate + global flag

---

## 9. Things we still don't have built (good to know)

- **Push notifications** (in-app only today; no SMS/email/web push).
- **Daily streak / quest system** to bring users back.
- **Leaderboards** (data exists, no UI yet).
- **Withdrawal proof feed** ("X paid out today") — high-trust signal, not built.
- **Multi-asset trading** — GOLD infrastructure is laid (mig 0048-0052) but oracle worker not deployed.
- **Agent/referral commission** — stripped from the prediction-market codebase; would need to be rebuilt.

---

## 10. The single most important thing to monitor

**Withdrawal SLA.** One viral story of "I deposited $500 and can't get it out" will kill the brand faster than any pricing bug. Per current setup the manual review SLA starts at 15-60 minutes and tightens to sub-2-minutes after fraud profile is known. Pre-launch, manually walk through 10 withdrawal cycles end-to-end and make sure the queue stays empty and the payout actually arrives.

Everything else is recoverable. A withdrawal failure is not.

---

## Glossary

- **Strike / target** — the BTC price at the moment the market opened. The line UP and DOWN are betting around.
- **Spread** — the house edge baked into the odds. 5% on 5m, 8% on 1m.
- **Soft-block** — automatic button-greying when odds get too extreme.
- **Push** — the close price equals the target exactly. Today: refund. After tie-rule flip: heavy side loses.
- **Wick** — a brief, possibly-manipulated price spike at close. Defended by median-of-30-ticks fallback.
- **Mark price** — the current "fair" probability the server thinks UP wins, used for cashout math.
- **Offered price** — the price the user actually pays (mark + spread + matrix + shading).
- **NGR (Net Gaming Revenue)** — daily house P&L. Stakes in minus payouts out minus refunds out.
- **CLV (Closing Line Value)** — how much a user beats the market by on average. Sharp users have positive CLV.
- **Matrix** — a calibration table that adjusts pricing in extreme zones based on historical outcomes.

---

**One sentence:** every market is a 60-second or 5-minute bet on BTC going up or down, the house makes money from the spread plus small cashout margins plus tie conversions, and every limit in `/admin/markets-config` is a dial you can move in 10 seconds to tighten or loosen the book.
