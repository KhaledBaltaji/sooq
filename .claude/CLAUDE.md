# Claude Code Session Rules — Sooq Speed

## Identity

Real-money BTC fast-cycle prediction trading for the MENA region. Mistakes hit user wallets directly. Treat every database operation, migration, and deployment as if real money is at stake — because it will be once we relaunch.

## Hard Constraints

- **No production access.** `sooq.exchange` is still on the old `prediction-market` Vercel project. Don't push, alias, or run SQL against it.
- **No direct pushes to `main`.** All changes flow `staging` → PR → `main` only when Khaled greenlights production cutover (W12+).
- **Before any `git push`:** state the branch + diff summary, wait for explicit user confirmation.
- **Before any commit:** `npx tsc --noEmit` + `npm run build` must both exit 0. Pre-commit hook enforces tsc.
- **Before any migration applies to RDS staging:** explicit user confirmation. Use the existing `scripts/apply-*.mjs` pattern, never raw `psql` from the session.
- **NEVER** type credentials, access keys, OTP codes — the user pastes them themselves.
- **NEVER** create AWS / GitHub / Google / Vercel / Stripe accounts on the user's behalf.

## Environment Quick Reference

| Env | Where | DB | Notes |
|---|---|---|---|
| **Local dev** | `next dev` on `localhost:3000` | RDS staging via `.env.local` | EC2 oracle shared with staging |
| **Staging** | `staging.sooq.exchange` (Vercel `sooq` project) | RDS `sooq-staging-db` (eu-central-1) | Push to `staging` branch → Vercel auto-deploys → manual `vercel alias set` |
| **Production** | NOT YET PROVISIONED | — | Old prediction-market still serves `sooq.exchange` until relaunch |

`DATABASE_URL` in `.env.local` points at RDS staging directly. The pg client strips `sslmode` from the URL and sets `rejectUnauthorized: false` (matches `src/lib/db/index.ts`).

## Multi-Session Safety

Multiple Claude Code sessions may run simultaneously on this repo:

- Before editing any file, check `.claude/sessions/locks/` for active locks (heartbeat < 2 hrs).
- Before creating any migration, reserve the number in `.claude/sessions/migrations/next.json` so two sessions don't grab the same slot.
- See root `CLAUDE.md` "Multi-Session Safety" for the full protocol.

In practice Khaled mostly works solo — but assume contention and follow the protocol when it applies.

## Bug Workflows

- **"Bug on staging"** → full access. Diagnose → fix → tsc + build → commit → push (with approval) → re-alias if needed.
- **"Bug on live (sooq.exchange)"** → ZERO access. We don't touch the old prediction-market project. Surface the issue and tell Khaled.

## New Feature Flow

1. Read `CLAUDE.md` + `docs/ARCHITECTURE.md` + the latest `docs/SPRINT_LOG.md` entry to ground in current state.
2. Explore impacted code areas (Explore agent if scope is uncertain).
3. Ask clarifying questions about impact on existing flows (auth, speed RPCs, money flow, admin) before designing.
4. For schema/RPC/architecture changes, use `/plan-eng-review`. For small UI/copy changes, implement directly.

NEVER start implementing without understanding what you're touching first.

## Rebuild Sprint

- Plan: `~/.claude/plans/oh-my-how-much-giggly-crystal.md`
- Progress log: `docs/SPRINT_LOG.md`
- Phases W1–W11 are done. W12 (production cutover) is parked until Khaled greenlights relaunch.
- LMSR / branches / commission / demo / prelaunch / handle_fee / resolution_fee are all stripped or never wired in. Don't re-add without a fresh spec.

## Locked-in Financial Decisions (current as of mig 0028–0031, pricing engine v2)

- **No handle fee.** Mig 0013 deleted `speed_handle_fee_pct`. New trades store NULL in `speed_trades.handle_fee` (column kept for historical rows).
- **No resolution fee.** Winners get exactly `stake / entry_offered_prob`. No haircut.
- **Active durations:** 5m + 1h only. Trade RPC rejects 15m / 24h at runtime. Enum values stay for FK integrity.
- **Pricing engine v2 (mig 0028):** No 0.99 saturation clamp. Hard reject when `fair_prob_side > 0.97` or `< 0.03`. In last 30s, additionally reject when `|fair − 0.5| > 0.30` (closes Rami's pattern-matching exploit). Multiplicative late-window spread escalation (× 1.4 last 60s, × 1.8 last 30s). Last 10s rejected entirely.
- **IV (mig 0029):** read from `speed_volatility_cache` via `_speed_get_iv()` helper. Multi-horizon (5m, 15m, 1h, 24h, ewma). Fail-closed mode toggleable via `speed_iv_fail_closed`. Server NEVER prices with client-supplied IV.
- **Cashout (mig 0028, option C profit-based):** direction-matching invariant — `mark_prob > entry_offered_prob ⇒ cashout > stake. Always.` Winning side margin: 2.5–5% (CFD-style invisible spread on close). Losing side margin: 8–14% (CFD-style slippage on stops). 8 fee_config keys (replace old 10-key decay matrix). Last 10s rejected. Last 30s near-decided block.
- **Quote/execute parity (mig 0030):** `/api/speed/quote` returns snapshot; client echoes as `expected_*` params; RPC rejects with `PARITY_DRIFT` on any drift beyond tolerance (2% probs, 0.1% spot, exact bucket).
- **Risk caps (mig 0028 + 0031):** per-side 25% of pool collateral, per-user-per-market-per-side $200 (admin-tunable), same-strike-cluster 30% of pool, daily NGR floor -$500 circuit breaker (auto-reset UTC midnight). Pool collateral via `speed_pool_collateral_usd` ($10k default).
- **No daily wager cap (founder choice, mig 0031).** Replaced by soft guards: per-user velocity limiter (30 bets/min hard reject), per-user open-exposure (15% pool hard reject), per-user daily-handle telemetry alert ($5K threshold, no enforcement, logs to `speed_user_alerts`).
- **Settlement:** exact oracle tick at-or-before `closes_at`. Wick detector with 0.15% threshold (mig 0018) falls back to median-of-30-ticks. Audit row to `speed_market_settlement_audit`.
- **Cash pool ≠ revenue.** Platform `net = stakes_in − payouts_out − cashouts_out − refunds_out` per UTC day, cached in `speed_daily_ngr`.
- **Withdrawals are no-PIN.** Admin auth via `is_admin` flag + `app.user_id` GUC. Flow: `admin_approve_withdrawal` / `admin_reject_withdrawal` / `admin_mark_withdrawal_sent_v2` (mig 0015). **At launch withdrawal SLA starts at 15–60min with risk scoring + manual review**, tightening to sub-2min after fraud profile is known (Codex pushback: sub-2min at launch is dangerous, not the moat — fraud drains before review).
- **Positioning: "fair trading sensation, CFD economics."** UX feels like Polymarket; extraction is Plus500-grade. Direction-matching cashout, exact-tick settlement, withdrawals work — those are non-negotiably fair. Spread, late-window escalation, cashout margin — invisible, baked into prices. Marketing uses "trade" never "casino".
