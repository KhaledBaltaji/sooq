# Commission Branch — Design

**Status:** APPROVED (CEO + Eng review 2026-04-22/23) — implementation in progress
**Plan:** `/Users/khaledbaltaji/.claude/plans/wtf-ru-doing-dont-recursive-thompson.md`
**Depends on:** S2 branches (mig 202–225), bookmaker park (mig 291), commission model (mig 150)

---

## 1. Motivation

An agent who builds a real referral network outgrows `/r/[code]` + the personal `/referral` dashboard. They want a branded URL, a per-user view, a sub-agent hierarchy, and ops tooling. Reseller and bookmaker branches already solve those UX problems — but both assume the operator **holds capital** and **prices trades differently** from retail.

A **commission branch** fills the middle ground: branch UX on top of a pure agent commission flow. Zero capital, zero pricing change, zero solvency risk, zero incremental cost to SOOQ.

## 2. One-line definition

> A commission branch is a **branded, manageable wrapper around an agent's referral network**. Users trade on the retail engine at retail prices; the branch owner earns L1–L4 referral commissions; sub-agents appear in the existing 2-layer `referral_chain` rather than through a separate split mechanism.

## 3. Comparison with existing branch types

| Dimension | Reseller | Bookmaker (parked) | **Commission** |
|---|---|---|---|
| `branch_book_type` | `reseller` | `bookmaker` (if preserved) | `commission` |
| Holds capital | ✓ | ✓ | ✗ |
| Solvency gate | ✓ | ✓ | ✗ |
| Can enter payback mode | ✓ | ✓ | ✗ (DB CHECK blocks it) |
| Custom pricing | ✓ (flat markup) | ✓ (dynamic overlay) | ✗ (retail prices) |
| Users locked to branch (venue lock) | ✓ | ✓ | ✗ (users stay retail) |
| `/b/[slug]/*` URL | ✓ | ✓ | ✓ |
| `/branch/dashboard` | ✓ (full) | ✓ (full) | ✓ (subset) |
| Sub-agent hierarchy | ✓ (pl or commission type) | ✓ (pl or commission type) | ✓ (commission type only, zero deposit) |
| Revenue model | markup + branch fee | vig + SOOQ fee accrual | L1–L4 referral commissions on platform revenue |
| Source of commission | (N/A) | (N/A) | `pay_trade_commissions` via existing `referral_chain` |

## 4. Core design decisions

### 4.1 Users remain retail (no venue lock)

Commission-branch users sign up with:
- `users.referred_by = [sub-agent.user_id OR branch.manager_user_id]`
- `users.signup_branch_id = branch.id` (new column, for attribution)
- `users.referral_chain` populated by existing `handle_referral_signup` trigger (AFTER UPDATE on users when `referred_by` transitions NULL → non-NULL)

Why: commission branches don't run their own LMSR and don't hold deposits. There is no venue-lock enforcement path for commission users — they trade on the retail engine exactly like unreferred users. (Note: the prior `users.venue_type` / `users.assigned_branch_id` columns from the bookmaker era were dropped by mig 291. Commission branches don't need them.)

Consequence: a user who signed up via a commission branch can still trade if that branch is suspended. Their commission upline survives (it's on the user row).

### 4.2 Zero pool, zero pricing change — enforced in the database

`branches_commission_no_capital` CHECK: for any row with `book_type = 'commission'`:
- `pool_balance = 0`
- `worst_case_total = 0`
- `pending_payouts = 0`
- `yes_markup_pct = 0` / `no_markup_pct = 0`
- `exit_fee_pct = 0`
- `branch_fee_rate = 0`
- `solvency_override_pct IS NULL` / `solvency_override_until IS NULL`

`branches_commission_no_payback` CHECK: `book_type = 'commission' → status ≠ 'payback'`.

Users trade via retail `execute_trade`. The branch is purely **attribution + UX**.

### 4.3 Sub-agents ride the existing 2-layer referral chain

Key simplification from eng review: no new split-logic code. Sub-agents piggyback on the existing `referral_chain`:

- `/b/[slug]/?agent=[sub_code]` signup → `referred_by = sub_agent.user_id`
- `handle_referral_signup()` (mig 033) trigger populates `referral_chain = [sub_agent, branch_owner, ...ancestors]`
- `pay_trade_commissions()` (mig 150) walks the chain: sub-agent gets layer-1 rate at their own tier, branch owner gets layer-2 rate at their own tier
- Sub-agent accrues their own `network_volume`, progresses L1→L4 naturally, and has their own activation gate

No new commission-split function, no new table, no new RPC. The 2-layer chain already does what we need.

### 4.4 Cross-branch sub-agent rejection

If a user hits `/b/alice-sports/?agent=[bob_beirut_code]` where Bob is a sub-agent of a different branch (beirut-bets), the resolver rejects with `BRANCH_SCOPE_MISMATCH`. No silent fallthrough. Prevents cross-network scraping and enforces the "sub-agent belongs to the URL's branch" invariant.

### 4.5 First-touch attribution

If a user already has `referred_by` set (e.g., signed up months ago via Sarah's `/r/sarah-code`), hitting a commission branch URL does NOT rewrite attribution. Sarah keeps earning on that user's trades forever. Industry standard; protects long-time agents from having their networks poached.

Implementation: resolver checks `users.referred_by` before applying any new attribution. If already set, logs a skipped-rewrite event and returns success (ok=true, kind=<path>, but no DB write). `signup_branch_id` also stays unset to keep attribution internally consistent.

### 4.6 Dashboard: subset of existing `/branch/dashboard`

`branch_dashboard_stats` RPC dispatches on `book_type`:

- `reseller`: pool balance, worst_case, pending_payouts, volume, trade count, revenue (legacy behavior — unchanged)
- `commission`: attributed users (via `signup_branch_id`), active sub-agents, credited commissions, escrowed commissions, qualified-referral count, network volume, agent level, activation flag

Sidebar nav dispatches on `book_type`:

- Reseller: Dashboard / Users / Agents / Revenue / Markets / Pool Ledger
- Commission: Dashboard / Users / Sub-Agents / Commissions

UI shell (layout, mobile sheet, account card) is shared — only the nav items and dashboard overview differ.

### 4.7 Activation gate still applies

The branch owner is still a regular agent. They need 5 qualified referrals before commissions are released (escrowed until then). Admin override via existing `toggle_agent_activation_override` works unchanged.

Sub-agents also inherit the standard activation gate (because they're now in the referral_chain; no separate sub-agent activation model).

### 4.8 Admin creates commission branches

`admin_create_branch` RPC extended with two new parameters:

- `p_book_type TEXT DEFAULT 'reseller'` — `'commission'` or `'reseller'`. `'bookmaker'` rejected (parked).
- `p_slug` (via `p_code`) — for commission branches, validated against the strict format regex and the reserved-word blocklist pre-insert so admins get friendly errors instead of raw CHECK violations.

Commission branches skip the `branch_user_assignments` write (there's no venue lock). All capital fields forced to zero at insert.

### 4.9 Share kit (accepted scope expansion)

`/branch/dashboard` for commission owners surfaces a "Share your branch" CTA that opens `ShareKitModal`:

1. OG image preview rendered by new route `/api/og/branch/[branchCode]`
2. Pre-written WhatsApp/Telegram/X copy in English + Arabic with copy-to-clipboard
3. QR code PNG (rendered via qrserver.com, downloadable for print)

MENA-aware: WhatsApp-first, Arabic RTL-ready, no new npm deps.

### 4.10 Feature flags

Two independent flags, following the existing `branch-feature-flag.ts` pattern:

- `NEXT_PUBLIC_BRANCH_ENABLED` — gates reseller branches (existing)
- `NEXT_PUBLIC_COMMISSION_BRANCH_ENABLED` — gates commission branches (new)

Separate flags allow independent rollout. Admin create form hides the "Commission" type option when the commission flag is off.

## 5. Schema changes

| Migration | Scope | Status |
|---|---|---|
| **289** | `ALTER TYPE branch_book_type ADD VALUE IF NOT EXISTS 'commission'`, with a DO-block CREATE TYPE fallback so it's idempotent on both staging (enum exists from mig 280) and fresh prod (enum doesn't exist because 280 was reverted and 291 hasn't run yet — 289 < 291 by filename). Unwrapped (no BEGIN/COMMIT) per Postgres ALTER TYPE ADD VALUE requirement. | Applied to staging via commit 3ad4de4 |
| 291 (external) | Bookmaker park — recreates the multi-branch-type foundation (`branches.book_type` column, `_protect_branch_book_type` trigger, `idx_branches_book_type` index) and drops bookmaker-specific columns including `users.venue_type` and `users.assigned_branch_id` | Applied |
| **293** | `users.signup_branch_id` column (FK with ON DELETE RESTRICT + partial index), `branches_commission_no_capital` CHECK, `branches_commission_no_payback` CHECK, `branches_commission_slug_format` CHECK, `_reserved_slugs()` helper + trigger, `branch_agents` trigger (BEFORE INSERT OR UPDATE), extended `admin_create_branch` RPC, extended `branch_dashboard_stats` RPC | Drafted, not applied |

**Apply order on fresh prod:** 289 (creates enum + adds 'commission' via DO-block fallback) → 291 (parks bookmaker, keeps foundation, enum already has all three values) → 293 (constraints + attribution column + RPC extensions). All three are idempotent via `IF NOT EXISTS` patterns.

No new tables. All data lives in existing `branches`, `branch_agents`, `users`, `referral_commissions`.

## 6. Invariants

1. A commission branch NEVER holds money — `pool_balance = 0` enforced by CHECK.
2. A commission branch NEVER modifies trade prices — users trade on retail `execute_trade`.
3. Users of a commission branch trade on the retail engine. There is no venue-lock column (the bookmaker-era `venue_type` and `assigned_branch_id` were dropped by mig 291); attribution is recorded only in `users.signup_branch_id` + `users.referred_by` + `users.referral_chain`.
4. `branch_book_type` remains immutable post-creation (existing `_protect_branch_book_type` trigger).
5. Commission-branch sub-agents have `agent_type = 'commission'` and `deposit_required = 0` / `deposit_held = 0` (trigger-enforced on INSERT OR UPDATE).
6. First-touch attribution wins — existing `referred_by` is never rewritten.
7. Cross-branch sub-agent codes are rejected at the resolver (no silent fallthrough).
8. `users.signup_branch_id` FK uses `ON DELETE RESTRICT` — branches with attributed users cannot be deleted, only suspended.
9. Commission branches cannot enter `payback` status (CHECK-enforced).

## 7. Code surface

### Database (migrations)
- `supabase/migrations/289_commission_branch_enum.sql` (idempotent: DO-block CREATE TYPE + ALTER TYPE IF NOT EXISTS)
- `supabase/migrations/293_commission_branch_constraints.sql`

### Backend (resolvers + helpers)
- `src/lib/slug-rules.ts` (new) — single source for slug format + reserved list, imported by admin UI + resolver + RPC. DB CHECK mirrors the regex literal.
- `src/lib/commission-branch-feature-flag.ts` (new)
- `src/lib/auth/actions.ts` (refactored) — `resolveAndApplyReferral` now dispatches on a typed `ResolverInput` union: `{type: 'direct_code', code}` or `{type: 'branch_signup', branchSlug, agentCode?}`. Apply step branches on a typed `AttributionPath` union. First-touch guard + cross-branch rejection enforced in-line. Back-compat with string input preserved for existing `/r/[code]` callers.
- `src/app/api/auth/verify-otp/route.ts` — accepts `branchSlug` + `agentCode` in request body, chooses ResolverInput shape.
- `src/app/auth/callback/route.ts` — reads `branch` + `agent` query params, builds ResolverInput.
- `src/components/auth/auth-steps.tsx` — captures `?branch=` and `?agent=` from URL + pathname, forwards through OTP + OAuth flows.

### Frontend (dashboard + admin)
- `src/app/branch/layout.tsx` — gate dispatch: commission branches require `COMMISSION_BRANCH_ENABLED`, others require `BRANCH_ENABLED`.
- `src/app/branch/dashboard/page.tsx` — book_type dispatch; new `CommissionDashboard` variant with activation banner, tier progress, share CTA.
- `src/components/branch/branch-sidebar.tsx` — nav items vary by book_type.
- `src/components/branch/share-kit-modal.tsx` (new) — OG preview + copy-paste + QR.
- `src/components/branch/share-kit-button.tsx` (new) — client-side modal trigger for server-rendered dashboard.
- `src/app/api/og/branch/[branchCode]/route.tsx` (new) — branch-level OG image.
- `src/app/admin/branches/create/page.tsx` — book_type selector + slug input with live validation; commission flow skips Step 2 (configuration).
- `src/types/branch.ts` — `BranchBookType` union, split `BranchDashboardStats` into discriminated union.

### Tests
- `src/tests/db/commission-branch.test.ts` (new) — CHECK violations, trigger rejects, FK restrict, RPC dispatch, regression guards for reseller behavior.
- `src/tests/db/helpers.ts` — `createTestCommissionBranch` helper.

## 8. Risks & open items

| Risk | Mitigation |
|---|---|
| Confusion between "referral agent" and "commission branch owner" | UI shows "Commission Branch" badge on the branch owner's dashboard. Admin table shows the book_type column. |
| Commission branch owner is also a reseller branch manager | Allowed. `branches.manager_user_id` is not unique, just indexed. The owner holds two separate branches. |
| Sub-agent re-assignment after a user signs up | Not supported in v1. If a sub-agent becomes inactive, existing commissions on past trades keep flowing (status frozen at trade time). New signups via that sub-agent's code fall through to the branch manager with a warn log. |
| `branch_agents.parent_agent_id` loop detection | Pre-existing risk, outside this plan's scope. Any sub-agent hierarchy UI must protect against A→B→A cycles. |
| Slug phishing | Admin-only creation + reserved-word blocklist. No automatic similarity check in v1 (deferred per CEO review). |
| External QR API down | Share-kit modal degrades gracefully — QR image fails to load, but text copy-paste and OG preview still work. |

**Open items (non-blocking):**

- User-facing name ("Commission Branch" vs "Affiliate Branch") — backend stays `commission`.
- Pre-launch marketing visibility of commission branches — likely hidden per `feedback_hide_social_proof_user_ui.md`.
- Eligibility policy — default: admin-created for any user, no tier requirement. Post-launch consideration: auto-promote at L3 + 20 qualified referrals.

## 9. Non-goals

- No trading engine (users trade retail).
- No pool, no solvency, no payback mode.
- No bookmaker overlay (no dynamic vig).
- No P/L agents under commission branches.
- No venue-lock enforcement on commission-branch users (the `venue_type` enum no longer exists post mig 291).
- No independent fee config (reuse existing `ngr_commission_*` rows).
- No public profile page (deferred — skipped in CEO review).
- No push notifications for sub-agent commission earnings (deferred — skipped in CEO review).
- No self-serve branch application (admin-only creation for v1).
