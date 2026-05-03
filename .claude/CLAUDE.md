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

## Locked-in Financial Decisions (current as of mig 369)

- **No handle fee.** Mig 369 deleted `speed_handle_fee_pct` from `fee_config` entirely; trade RPC no longer touches `speed_trades.handle_fee` (column kept for pre-mig-369 historical rows, new trades store NULL). The 1% phantom fee was rolled into the spread.
- **No resolution fee.** Winners get exactly `stake / entry_offered_prob`. No haircut.
- **Sole revenue:** AMM spread (5% baseline, baked into `offered_prob` — raised from 4% in mig 369 to absorb the deleted handle fee) + cashout premium (continuous duration-specific decay × liq_discount, mig 369). Cashout premium is the casino moneymaker; no winner/loser branch.
- **Active durations:** 5m + 1h only. Trade RPC rejects 15m / 24h at runtime. Enum values stay for historical FK integrity.
- **Risk caps (mig 369):** per-side 25% of pool collateral, per-user-per-market $200, per-user-daily $500, same-strike-cluster 30% of pool, daily NGR floor -$500 (auto-resets at UTC midnight). All tunable via `fee_config`.
- **Settlement:** exact oracle tick at-or-before `closes_at` (mig 369; pre-369 used 30s TWAP). Wick detector with 0.1% threshold falls back to median-of-30-ticks. Audit row to `speed_market_settlement_audit`.
- **Late window (entries):** last 60s +20% spread, last 30s +30% spread, last 10s reject. Cashouts: last 5s reject (last-tick arbitrage protection).
- **Cash pool ≠ revenue.** Open positions' stakes are held funds; the platform's `net = stakes_in − payouts_out − cashout_out − refund_out` per UTC day, cached in `speed_daily_ngr`.
- **Withdrawals are no-PIN.** Admin auth via `is_admin` flag through Auth.js + `app.user_id` GUC. New flow uses `admin_approve_withdrawal` / `admin_reject_withdrawal` / `admin_mark_withdrawal_sent_v2` from mig 0015. **Withdrawal SLA is the moat — sub-2-min for amounts under $500. Casino-mode pricing is conditional on this staying solid.**
