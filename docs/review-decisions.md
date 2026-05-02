# Review Decisions Log — MENA Prediction Market

> All decisions from CEO, Engineering, Design, and Codex reviews.
> Date: 2026-03-23/24. These override any conflicting statements in other docs.

## Document Hierarchy (in case of conflict)

1. **This file** (`docs/review-decisions.md`) — final decisions
2. **`docs/commission-model.md`** — canonical commission spec
3. **`CLAUDE.md`** — project conventions and architecture
4. **`DESIGN.md`** — design system tokens
5. **`docs/technical-brief-v2.md`** — product spec (some parts superseded)
6. **`docs/office-hours-design-doc.md`** — problem statement (commission model superseded)
7. **`docs/plan-summary.md`** — summary (commission model superseded)

---

## CEO Review Decisions (2026-03-23)

### 1. Both-Side Betting: ALLOWED with safeguards
- Users CAN bet both YES and NO on the same market
- Original restriction removed to improve liquidity
- Safeguards replace the restriction (see items 2-6)
- **Overrides:** technical-brief-v2.md line 48, line 177, line 497

### 2. Net-Exposure Commission Cap
- Commission calculated on NET position per market: ABS(YES bets - NO bets)
- If user bets equal amounts both sides → net exposure = $0 → commission = $0 at ALL depth tiers
- Prevents commission gaming via hedged volume

### 3. No same_side Database Constraint
- `003_bets.sql` must NOT include the same_side CHECK constraint
- Add explicit comment: `-- NO same_side constraint per CEO review`
- **Overrides:** technical-brief-v2.md line 177

### 4. Portfolio: Individual Bet Display
- Both-side bets shown as separate cards (no net-position grouping at MVP)

### 5. Leaderboard: Net-Correct Accuracy
- Markets where user bet both sides excluded from accuracy %

### 6. Admin Risk Alert: Both-Side Detection
- New alert type: flags users betting both sides of same market

---

## Engineering Review Decisions (2026-03-23)

### 7. resolve_market Decomposition
Break into composable sub-functions within one atomic transaction:
- `calculate_payouts(market_id, outcome)` → payout records
- `distribute_payouts(payout_records)` → credits winners
- `settle_commissions(market_id)` → multi-level, net-exposure cap
- `record_revenue(market_id, fee_amount, commissions)` → platform_revenue
- `resolve_market()` orchestrates all four

### 8. SELECT FOR UPDATE on Balance Operations
All balance-mutating functions must lock the user row first:
`SELECT ... FROM users WHERE id = auth.uid() FOR UPDATE`
Applies to: `place_bet`, `process_withdrawal`, `withdrawal_approve`

### 9. Activity Feed Client-Side Throttle
- Max 1 UI update per second on realtime bets subscription
- Events queued in-memory, latest N displayed
- Pool totals via market table realtime (no throttle)

### 10. Fee Constants from fee_config Table
- Platform fee (7%) and ALL commission rates from fee_config table
- NOT hardcoded in Postgres functions or TypeScript
- Admin can update from dashboard, changes take effect immediately

### 11. Zero-Pool Division Guard
- `place_bet` guards against division by zero if side_pool = 0
- Market creation validates seed_amount_yes > 0 AND seed_amount_no > 0

### 12. Leaderboard Materialized View
- `leaderboard_stats` materialized view for accuracy % and profit per user
- Excludes both-side markets from accuracy
- Refreshed via trigger on resolve_market

### 13. Full Test Coverage (38 test cases)
- 22 originally planned + 16 added by eng review
- Covers: race conditions, boundary cases, both-side betting, concurrent ops
- Property-based payout invariants required

---

## Design Review Decisions (2026-03-23)

### 14. Screen Hierarchy: Question-First
Home screen leads with market question (Arabic, Satoshi Bold 24-32px),
NOT payout number. Payout appears after user starts typing amount.

### 15. Interaction State Coverage
Full state table for all 9 features: loading (skeletons), empty (warmth + CTA),
error (retry), success (animations). See plan file for complete table.

### 16. First-Time User Flow: Taste Before Deposit
Zero-balance users CAN interact with bet panel, see payout animate.
Confirm button reads "Deposit $X to Bet" — redirects to deposit flow.

### 17. RTL: Pool Bar Stays Fixed
YES always left (blue), NO always right (amber) regardless of language.
Data visualizations don't mirror. Text, nav, icons DO mirror.

### 18. Responsive Layout
- Mobile (375px): single column, bottom nav, full-width cards
- Tablet (768px+): two column, sidebar nav
- Desktop (1024px+): three column, top nav, max 1200px

### 19. Admin: Functional + High-Care Resolution
Standard shadcn/ui for all admin pages. Resolve market page gets special treatment:
red "FINAL" warning, payout preview breakdown, two-step confirm.

---

## Codex Review Decisions (2026-03-24)

### 20. auth.uid() for All User-Facing RPCs (CRITICAL SECURITY)
User-facing Postgres functions must NEVER accept user_id as a client parameter.
- `place_bet(p_market_id, p_side, p_amount)` → auth.uid()
- `process_withdrawal(p_amount, p_destination, p_currency)` → auth.uid()
- `claim_deposit_bonus()` → auth.uid()
Only admin/webhook functions accept user_id as parameter.

### 21. Deposit Bonus: $20+ Non-Referred Only (ANTI-FARMING)
- Bonus ($5 free) only for users who signed up WITHOUT a referral code
- Only on first deposit of $20 or more
- Referred users do NOT get deposit bonus (agent relationship is their incentive)

---

## Commission Model Change (2026-03-24)

### 22. Multi-Level Revenue Share (replaces flat 5%)
- 4 agent levels (L1-L4) based on direct referral count
- 3 depth tiers (Tier 1 direct, Tier 2 indirect, Tier 3 deep)
- Max combined cost: 3.05% per bet
- Platform keeps minimum 3.95%
- **Full spec:** `docs/commission-model.md` (canonical source)
- **Overrides:** ALL prior commission references in all documents

---

## Codex Strategic Warnings (noted, not blocking)

These were flagged by Codex as risks. Acknowledged but not blocking build:
- Payout scaling factor is by design (users see locked ratio as "up to" amount)
- Double-entry accounting deferred to post-validation (append-only ledger sufficient for MVP)
- Admin dual-control deferred (two-step confirm on resolution is the MVP safeguard)
- Unit economics are thin on referred bets (agent program is "first to cut" if no organic pull)
- Simulated cold-start activity is labeled, acknowledged as temporary
- Slow product loop (political markets) is accepted — MENA has frequent political events
- Stablecoin risk minimal (MVP is USDT on Tron only)
