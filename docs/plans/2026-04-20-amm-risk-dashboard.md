# AMM Risk Dashboard — plan

## Context

`/admin/amm` is labeled "AMM Risk Dashboard" but displays zero risk metrics. Every number on it is backward-looking: total volume, trade count, seed P&L, current prices, and fee revenue already collected. For a real-money platform, the operator needs forward-looking exposure visibility — how much the AMM could owe if each open market resolves against us, how much cash we've collected against that obligation, and whether we're undercapitalized at any point.

The pattern is already solved on the branch subsystem (`branches.worst_case_total`, `branch_solvency_check` RPC, `SolvencyCard` component rendered at `/admin/branches/[id]`). We just have not applied it to the core LMSR AMM. This plan extends the existing AMM page to become a real risk dashboard.

**Out of scope:**
- Time-series trend charts / history table
- Branch pool risk (already covered at `/admin/branches`)
- Deposit/withdrawal platform-wide reconciliation (separate subsystem, different cron)
- Real-time websocket updates — periodic page reload is fine for ops
- User-level exposure (how much any single user could win if their side resolves)

## What we're building

### One new RPC: `get_amm_risk_snapshot()`

Returns two logical sections in a single table: one aggregate row (`market_id IS NULL`) and one row per market that has an `amm_state` record.

```sql
CREATE FUNCTION get_amm_risk_snapshot()
RETURNS TABLE (
  section TEXT,                    -- 'aggregate' | 'per_market'
  market_id UUID,
  market_name TEXT,
  market_status market_status,
  liquidity_param DECIMAL(18,6),
  q_yes DECIMAL(18,6),
  q_no DECIMAL(18,6),
  imbalance DECIMAL(10,6),         -- 0 (balanced) .. 1 (all one side)
  cash_in DECIMAL(18,2),           -- net cash the AMM holds from this market
  worst_case_payout DECIMAL(18,2), -- max owed if either side wins
  net_exposure DECIMAL(18,2),      -- worst_case_payout - cash_in; positive = at risk
  theoretical_max_loss DECIMAL(18,2), -- b × ln(2); LMSR cap
  is_red_flag BOOLEAN              -- per-market: true when exposure or imbalance is high
)
LANGUAGE sql
STABLE
SECURITY DEFINER
```

**Admin gating** (matches the existing `/admin/amm` page gate so sub-admins granted the `amm` view don't hit a mystery permission error):

```sql
IF NOT EXISTS (
  SELECT 1 FROM users
  WHERE id = auth.uid()
    AND is_admin = TRUE
    AND (admin_allowed_views IS NULL OR 'amm' = ANY(admin_allowed_views))
) THEN
  RAISE EXCEPTION 'Not authorized';
END IF;
```

**Status filter:** `status IN ('open', 'closed')`. Excludes `resolved` + `voided` (already settled, zero forward liability) and `draft` (amm_state exists but zero trades — harmless noise that just clutters the table).

### Formulas (retail-AMM-correct)

> **Design note** (added after /plan-eng-review caught my initial mistake):
> The AMM's cash holdings and share obligations are tracked as *retail-only* columns
> on `amm_state`: `retail_net_cash`, `retail_shares_yes`, `retail_shares_no`. These are
> maintained directly by `execute_trade` (added in migration `20702_amm_state_fee_config_triggers.sql`;
> sell-side bug fixed in migration 218 at line 1011). They already exclude branch trades
> (which settle against `branch_pools`, not the retail AMM) and already account for fees
> correctly (`retail_net_cash` is incremented by net-of-fee amount on buy, decremented by
> *gross* LMSR proceeds on sell). The original plan tried to recompute these by summing
> `trades.total_cost` — that silently mixed branch trades into retail numbers and used
> a gross-of-fee amount the AMM never actually received.

**Per-market** (status `open` or `closed`; `draft`, `resolved`, `voided` excluded):

- `cash_in = amm_state.retail_net_cash` — direct read, already correct.
- `shares_yes = amm_state.retail_shares_yes`, `shares_no = amm_state.retail_shares_no` — direct reads.
- `resolution_fee_rate = COALESCE((SELECT rate FROM fee_config WHERE fee_type='resolution_fee' LIMIT 1), 0.01)` — defensive fallback matches the default rate used by prior migrations; prevents whole RPC from NULL-propagating if fee_config is ever incomplete.
- `worst_case_yes = shares_yes * (1 - resolution_fee_rate)` — AMM's obligation if YES wins: pay every retail YES share at $1 minus resolution fee.
- `worst_case_no = shares_no * (1 - resolution_fee_rate)` — symmetric.
- `worst_case_payout = GREATEST(worst_case_yes, worst_case_no)`.
- `net_exposure = worst_case_payout - cash_in`. Positive = AMM loses money if worst side wins. Negative = AMM profits regardless of outcome.
- `imbalance = CASE WHEN shares_yes + shares_no = 0 THEN 0 ELSE ABS(shares_yes - shares_no) / (shares_yes + shares_no) END`.
- `theoretical_max_loss = liquidity_param * LN(2)` — LMSR's fixed ceiling for a 2-outcome market, shown for context.
- `is_red_flag = net_exposure > 500 OR imbalance > 0.8`.

**Aggregate row** (`market_id IS NULL`, `section = 'aggregate'`):

- `worst_case_payout = SUM(per-market worst_case_payout)`
- `cash_in = SUM(per-market cash_in)` — can be negative on markets where users sold back more than they bought; summed honestly.
- `net_exposure = worst_case_payout - cash_in`
- `is_red_flag = net_exposure > 0` — platform retail AMM is undercapitalized on obligations.

> **Columns deliberately NOT used:** `amm_state.q_yes`, `amm_state.q_no`, `trades.total_cost`. These include branch flow and/or fee amounts that never reached the retail AMM pot. They're the right inputs for LMSR price computation but the wrong inputs for retail solvency.

### UI — same RPC, three consumers

The same `get_amm_risk_snapshot()` feeds three admin surfaces. Operators see current exposure wherever they naturally look for AMM health, not just the one page named "Risk."

#### 1. `src/app/admin/amm/page.tsx` — the primary risk view

Existing content (volume/trades/seed P&L/revenue breakdown) stays — it's still useful. We add a new risk section ABOVE the existing content.

- **Risk summary card row** (4 stats, same visual style as current Total Volume / Total Trades row):
   - **WORST-CASE PAYOUT** — aggregate `worst_case_payout`
   - **CASH IN** — aggregate `cash_in`
   - **NET EXPOSURE** — aggregate `net_exposure`, red if > 0, green if ≤ 0
   - **SOLVENCY** — `GREATEST(0, cash_in) / NULLIF(worst_case_payout, 0)` as percentage, or "∞" if worst_case is 0. Green ≥ 100%, amber 80–100%, red < 80%. The `GREATEST(0, …)` guard prevents negative aggregate cash_in (heavy-sell markets) from rendering as a misleading positive-looking percentage; when cash_in is negative the ratio reads 0% and the NET EXPOSURE card tells the dollar truth.

- **Red banner** (conditional) — shown only if aggregate `net_exposure > 0`:
   > ⚠ AMM is undercapitalized by $X if worst-case outcomes resolve. Monitor closely.

- **Per-market table** — add 4 columns to the existing table, between STATUS and YES/NO:
   - `WORST-CASE` — from RPC
   - `CASH IN` — from RPC
   - `NET EXPOSURE` — red if positive, green if ≤ 0
   - `IMBALANCE` — percentage, red icon 🚨 if `is_red_flag` is true

#### 2. `src/app/admin/accounting/page.tsx` — AMM tab

Today the AMM accounting tab only shows realized seed P&L from *resolved* markets (a historical view via `get_accounting_amm`). Add a 4-card "Current Exposure" strip ABOVE the existing `Resolved Markets — AMM P&L` section:

- **AGGREGATE WORST-CASE** — from the RPC's aggregate row
- **CASH IN** — aggregate
- **NET EXPOSURE** — aggregate, red when > 0
- **SOLVENCY %** — same formula as /admin/amm

Operators viewing accounting see both **past** (realized gains/losses below) and **present** (current liability above) on the same page. No changes to `get_accounting_amm` — we're adding a sibling data source next to it.

#### 3. `src/app/admin/stats/page.tsx` — Health tab

Today the Health tab's AMM section shows `total_seed_pnl` and total liquidity from `get_stats_health`. Add 2 cards to the same section:

- **WORST-CASE LIABILITY** — aggregate `worst_case_payout`
- **SOLVENCY %** — aggregate solvency ratio

These sit next to the existing seed-P&L/liquidity cards so the Health tab becomes a true platform-health snapshot (past + forward) rather than the realized-only view it is today.

### No new tables, no cron

History tracking is out of scope. If the operator wants trends later, we add a snapshot cron as a follow-up. For now, the page is computed on every load — the RPC is `STABLE` and runs a few aggregations over `amm_state` and `trades`; expected query time < 200ms even with hundreds of markets.

## Critical files

| Path | Purpose |
|---|---|
| `supabase/migrations/278_amm_risk_snapshot_rpc.sql` | New RPC + grant to authenticated (admin-gated inside function) |
| `src/app/admin/amm/page.tsx` | Add risk summary card row, red banner, table columns |
| `src/app/admin/accounting/page.tsx` | AMM tab: add "Current Exposure" 4-card strip above realized table |
| `src/app/admin/stats/page.tsx` | Health tab: add 2 cards (worst-case, solvency %) to AMM section |
| `src/tests/db/amm-risk-snapshot.test.ts` | New test file with 9 cases (added branch-trade isolation + fee_config fallback tests after review) |
| `docs/SCHEMA.md` | Append the RPC to the admin functions list |

## Reused existing code

- `amm_state` columns (`q_yes`, `q_no`, `liquidity_param`) already track everything LMSR-relevant — no schema change needed.
- `trades.direction` + `trades.total_cost` already drive cash_in computation — same pattern as branch solvency.
- Admin page layout + card styles + status badges — identical to existing `/admin/amm` elements.
- `fee_config` RPC pattern — we fetch `resolution_fee` rate the same way the existing `/admin/amm` reads the fee_config table.
- Pattern mirrors `branch_solvency_check` at `supabase/migrations/219_branch_settlement.sql` (approximately) — worst-case liability minus cash reserves.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RPC query slow on large market counts | Low | Minor page load slowness | `STABLE` hint; `idx_trades_market` already exists; can add index if > 1000 markets |
| Thresholds for `is_red_flag` wrong (500 / 0.8) | Medium | Noise or false calm | Ship as constants; adjust after observing prod signal for a week |
| `resolution_fee_rate` read from fee_config at RPC call time differs from when trades executed | Low | Minor valuation drift | Acceptable — the risk dashboard reflects current fee policy, not historical. Prod doesn't change fee_config frequently. |
| New RPC deployed but UI not wired up yet (partial merge) | Low | Page shows stale numbers | Commit RPC + UI in same PR |
| Admin non-super-admin sub-admins can't see the page | Low | Sub-admins who need AMM visibility blocked | `admin_allowed_views` already gates `/admin/amm` per existing `getViewKeyFromPathname` — no change needed |

## Test plan

Unit tests in `src/tests/db/amm-risk-snapshot.test.ts`:

1. **Empty DB** — no markets → RPC returns one aggregate row with zeros.
2. **Single retail buy** — cash_in equals `retail_net_cash` (net of explicit fee), worst_case = `retail_shares_yes × (1 − fee)`, net_exposure correct.
3. **Balanced market** — `retail_shares_yes = retail_shares_no` → `imbalance = 0`, worst_case equals both sides.
4. **Fully imbalanced** — `retail_shares_no = 0` → `imbalance = 1`, `is_red_flag = true` (imbalance > 0.8).
5. **Profitable market** — force cash_in > worst_case_payout → `net_exposure < 0`, not a red flag.
6. **Aggregate row** — two markets, one red-flagged → aggregate reflects `SUM` of per-market values.
7. **Admin gate** — non-admin + sub-admin-without-`amm`-view both get permission error; sub-admin-WITH-`amm`-view succeeds; super-admin succeeds.
8. **Branch-trade isolation** (added after review) — create a market, make one retail buy and one branch trade on the same market, assert the RPC's `cash_in` and `shares_*` reflect ONLY the retail portion (branch trade's movement does not appear in the risk numbers, because `retail_net_cash` and `retail_shares_yes/no` are only mutated by retail `execute_trade`).
9. **fee_config fallback** (added after review) — temporarily clear the `resolution_fee` row from `fee_config`, confirm COALESCE defaults to `0.01` and the RPC still returns valid non-NULL numbers. Restore after.

Manual UI check on staging: open `/admin/amm`, verify new risk row renders above existing content, verify red banner appears when aggregate net_exposure > 0 (force by creating a market with only buys and no fee revenue).

## Verification commands

```bash
# After migration applies on staging:
cat supabase/.temp/project-ref  # must be zzebptrztuwnqlxxmjuo
npx vitest run src/tests/db/amm-risk-snapshot.test.ts

# Sanity check RPC directly via Supabase MCP against staging:
# SELECT * FROM get_amm_risk_snapshot() ORDER BY section, net_exposure DESC NULLS LAST;
# Expect: 1 aggregate row + N per-market rows.
```

Browser check: `staging.sooq.exchange/admin/amm` — risk card row should appear above existing content, table should have 4 new columns.

## Rollback

- If RPC broken after deploy: write migration 279 that `DROP FUNCTION get_amm_risk_snapshot`; UI falls back to existing dashboard (new sections can conditional-render via try/catch or just show `—` on RPC error).
- No data written by this feature — purely read/compute. Nothing to migrate back.

## Not blocking launch

The existing `/admin/amm` page works and gives operator visibility into volume + revenue. This plan upgrades it to a real risk tool, but it is not on the launch-blocker list (payment integration, legal sign-off, prelaunch flip are). Landing it strengthens operational visibility once users start trading real money.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 0 internal issues; 8 issues raised by outside voice, all resolved in-plan |
| Outside Voice (adversarial) | Claude subagent (Codex rate-limited) | Independent 2nd opinion | 1 | ISSUES_FOUND | 8 findings — 3 High severity (all resolved via retail_net_cash rewrite), 5 Medium/Low (all resolved) |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | skipped — additions-only layout, no new visual patterns |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**OUTSIDE VOICE — KEY FINDINGS APPLIED:**
- H1/H2/H3/M1: Original formulas computed from `trades.total_cost` + shared `q_yes/q_no`, which silently mixed branch trades and fees into retail AMM numbers. **Rewrote** to use the already-correct retail columns (`amm_state.retail_net_cash`, `retail_shares_yes`, `retail_shares_no`) that `execute_trade` maintains.
- H4: Status filter narrowed to `('open', 'closed')` (excludes `draft` clutter).
- H5: Solvency ratio display uses `GREATEST(0, cash_in) / worst_case` to avoid misleading negative percentages.
- M2: RPC admin gate now matches the page — `is_admin AND (admin_allowed_views IS NULL OR 'amm' = ANY(admin_allowed_views))`. No sub-admin UX break.
- L2: Added branch-trade isolation test (case 8) and fee_config fallback test (case 9).

**CROSS-MODEL:** Not applicable — primary review (me) and outside voice (subagent) agreed after the outside voice surfaced findings that the primary missed. Primary updated its understanding; all findings incorporated with user approval.

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — plan ready to implement. Next: run /ship or implement directly.

