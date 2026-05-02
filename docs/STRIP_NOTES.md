# Strip Notes

Working scratch for the W2 + W3 strip. Captures coupling investigations,
ordered drop sequences, and surgical decisions made during the rebuild.

---

## W3: `speed_branches` ↔ `branches` coupling map

**Verdict: HEAVY coupling. `execute_speed_trade` is a state machine keyed on
reseller-vs-retail flow. Requires real surgery, not just `DROP TABLE`.**

Estimated W3 effort: 2.5–4 days (vs. plan budget of 5 days). Tight but doable.

### Migration 307: `speed_branches` table

- Sidecar table to `branches`. **Not** a clone.
- Primary key: `branch_id UUID` → FK to `branches(id)`
- Speed-specific columns: `speed_pool_balance`, `fee_share_pct`,
  `freeze_warn_pct`, `freeze_hard_pct`, `unfreeze_pct`, `stake_min`,
  `stake_max`, `stake_caps_per_side`, `speed_status`
- Per the migration's own comment: only **reseller** branches need a row.
  Commission branches earn via the retail commission walk on
  `users.referral_chain` (Flow A).

### `execute_speed_trade` (mig 319, patched in 340/345/352/354/356/359)

**Severity: MAJOR. Full rewrite required.**

Three distinct flow paths:
1. Reseller flow (user has `signup_branch_id`, branch is `reseller` book_type, `speed_branches` row exists with `speed_status='active'`)
2. Commission flow (user has `signup_branch_id`, branch is `commission` book_type)
3. Retail flow (no `signup_branch_id`)

Surgery required:
- Drop `v_signup_branch_id`, `v_routing_branch_id`, `v_speed_branch`,
  `v_is_reseller_flow` locals
- Collapse to retail-only path (the retail flow is the only survivor)
- Remove stake-cap enforcement against `speed_branches.stake_caps_per_side`
- Remove `speed_pool_ledger` writes keyed on `branch_id`
- Remove fee-share calculation
- Always call commission walk → **but** commission walk also strips entirely
  in W3, so net effect: trade just credits the user's net position and
  routes 100% of fees to the SOOQ main pool (or a hardcoded fee revenue
  account).

### `speed_execute_cashout` (mig 320)

**Severity: MODERATE.**

Conditional pool logic (lines 113–123, 191–210):
- IF position has `branch_id`, lock the `speed_branches` row, check
  status, debit `speed_pool_balance`
- ELSE: pay from SOOQ main pool

Surgery:
- Drop the `branch_id IS NOT NULL` branch (lines 114–123 + 191–210)
- All cashouts pay from main pool

### `speed_resolve_market` (mig 321)

**Severity: MODERATE.**

Same bifurcation pattern for refunds + winner payouts (lines 133–142):
- IF position has `branch_id`, debit `speed_branches.speed_pool_balance`
- ELSE: debit main pool

Surgery: same as cashout — drop the branch path, simplify to main-pool-only.

### `speed_admin_*` RPCs (mig 323/324/325)

**Severity: TRIVIAL.**

These are setup RPCs for reseller branches (`enable_branch`,
`freeze_branch`, `unfreeze_branch`, `credit_collateral`).

Surgery: **delete the migrations entirely.** No reseller branches = no setup RPCs needed.

### Speed cron RPCs

| RPC | File | Branch refs? |
|---|---|---|
| `speed_roll_markets` | mig 328 | None ✓ |
| `speed_resolve_expired_markets` | mig 329 | Inherits coupling via `speed_resolve_market` |
| `speed_rv_refresh` | (cron job) | None ✓ |

### Frontend hooks + UI

- `src/app/admin/branches/[id]/page.tsx` — reads `speed_branches` and `speed_pool_ledger`. Delete.
- All `src/app/branch/*` routes get deleted.
- `src/hooks/use-speed-*.ts` — verify none depend on `branch_id` in the response shape. Spot fix if so.

### Tables affected (drop list for W3)

**Drop entirely:**
- `branches`
- `branch_agents`
- `branch_pools`
- `branch_user_assignments`
- `branch_trades`
- `commission_branches`
- `speed_branches`
- `speed_pool_ledger` (only used by reseller flow)
- `referral_commissions`, `commission_payouts`, `agent_levels` (multi-level commission)

**Drop columns (after RPC surgery):**
- `users.signup_branch_id`
- `users.referral_chain` (multi-level commission tracker — gone)
- `speed_positions.branch_id`
- `speed_trades.branch_id`

### W3 execution order

1. Surgery on `execute_speed_trade` (rewrite to retail-only)
2. Surgery on `speed_execute_cashout` (drop branch path)
3. Surgery on `speed_resolve_market` (drop branch path)
4. Drop `speed_admin_*` RPCs and admin UI
5. Drop branch + commission RPCs that aren't called anywhere
6. Drop branch + commission tables (in dependency order)
7. Drop columns from `users`, `speed_positions`, `speed_trades`
8. Update / delete tests
9. Run full type-check + lint + smoke migrations on fresh Postgres
