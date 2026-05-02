# Plan: MENA Political Prediction Market — Office Hours Design Doc

## Context
The user is building a MENA political prediction market platform as a startup. They have a detailed technical brief (technical-brief-v2.md) with pool-based betting, locked payout ratios, agent/commission system, and crypto-behind-fintech UX. This office hours session produced an APPROVED design document covering the full platform build (Approach A).

## Design Doc Location
`~/.gstack/projects/prediction-market/khaledbaltaji-unknown-design-20260323-171951.md`

## Key Decisions Made
- **Approach:** Full platform build (not MVP/Telegram bot)
- **Beachhead:** Lebanon, expand to MENA
- **Wedge:** Political prediction markets (not sports)
- **Payout model:** Pool-based with locked ratios at placement (Option B)
- **Fee:** 7% platform fee (pot-level), 5% agent commission (from platform's take)
- **Architecture:** Supabase-only (no separate Node.js backend). Next.js → Supabase (Postgres + Auth + Realtime + Edge Functions)
- **Commission timing:** Escrow until resolution (overrides brief's "instant")
- **Market lock:** Admin can lock (no new bets) independently of resolution
- **KYC:** None at MVP, tier-based thresholds in fast-follow
- **Dark mode:** Deferred to post-validation
- **3pay:** Design for manual USDT transfer as primary; 3pay as upgrade (per outside voice finding)

## CEO Review Additions (Selective Expansion)
- WhatsApp/Telegram shareable market preview cards
- Push notifications for market resolution + wins
- Deposit bonus ($5 free on first deposit, 2x wagering)
- Anonymous live activity feed + simulated initial activity
- Rich political context on market detail pages
- Webhook auth: HMAC + on-chain verification + idempotency
- ISP blocking resilience: Cloudflare + mirror domain + Telegram/WhatsApp broadcast + PWA
- Cold start strategy: simulated activity + content-first approach

## CEO Review Spec Changes
- **Architecture:** Supabase-only (dropped separate Node.js backend)
- **Same-side betting:** REMOVED restriction. Users can bet both YES and NO on same market. Improves liquidity.
- **Demand validation:** Skip 5-person test. Launch IS the demand test.
- **Positioning:** Frame as "prediction exchange" not gambling platform (capital controls mitigation)
- **Agent system:** Full scope confirmed — referral tree is critical growth model based on founder's trading domain expertise

## Eng Review Decisions
- **Webhook:** Next.js API route at `/api/webhook/3pay` (not Edge Function)
- **Resolution:** Single atomic Postgres transaction (acceptable at MVP scale)
- **Balance:** Cached `balance_usd` + append-only ledger. Daily reconciliation job.
- **Testing:** Property-based tests for payout invariants (zero-sum, scaling factor, fee)
- **Same-side:** Restriction removed (CEO review decision confirmed)

## Design Review Decisions
- **Colors:** Blue (#3B82F6) YES, Amber (#F59E0B) NO. Dark bg #0A0A0A, Surface #1A1A1A
- **Language:** Browser language detection (Arabic/English)
- **Bet confirmation:** Swipe-to-confirm gesture (Cash App pattern)
- **Responsive:** Mobile-first (375px default), tablet (768px+), desktop (1024px+)
- **Interaction states:** Full state table documented (loading/empty/error/success/partial)
- **Design system:** Minimum tokens specified; full DESIGN.md via `/design-consultation` recommended

## Next Steps
1. Build the platform
2. Validate 3pay integration

## Verification
- Design doc is APPROVED at `~/.gstack/projects/prediction-market/`
- Wireframe HTML at `/tmp/gstack-sketch-1774279099.html`
- Technical brief at `/Users/khaledbaltaji/Downloads/technical-brief-v2.md`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 4 proposals, 4 accepted, 0 deferred |
| Outside Voice | claude subagent | Independent challenge | 1 | issues_found | 8 findings, all resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 5/10 → 8/10, 5 decisions |

**VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement.
