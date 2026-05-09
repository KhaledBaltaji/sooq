# Hidden config — what we tune and never touch

This is the operator's reference for every config knob that's hidden from
`/admin/fees` and `/admin/markets-config` by default. Each knob is still
live in the database; it's just been moved out of the day-to-day admin UI
because the operator should never touch it under normal operation.

To see a hidden knob in-app, click "Advanced — internal pricing knobs" at
the bottom of `/admin/fees`, or "Advanced (statistical)" inside any tab on
`/admin/markets-config`. Edits from those Advanced sections still go
through the same validated PATCH endpoint.

To regenerate the values below against staging:

```bash
node scripts/dump-hidden-config.mjs
```

The script writes back to this file, replacing the marked sections only
(headers + categorisations are preserved).

---

## /admin/fees — Advanced (internal pricing knobs)

These keys live in the `fee_config` table. Edit via the Advanced section
in the admin UI, or via SQL:

```sql
UPDATE fee_config SET rate = <value> WHERE fee_type = '<key>';
```

### Pricing engine internals

These bound the raw Black-Scholes pricing layer (before the matrix push-up).
Set during the initial pricing-engine v2 launch (mig 0028) and rarely
revisited.

<!-- BEGIN: fees-pricing-internals -->
| Key | Current | What it does |
|---|---|---|
| `speed_extreme_spread_coeff` | 8 | Quadratic widening past ±0.45 from 0.5 |
| `speed_late_60s_spread_mult` | 1.2 | Multiplier on base spread in last 60s (per-market overrides) |
| `speed_late_30s_spread_mult` | 1.4 | Multiplier on base spread in last 30s (per-market overrides) |
| `speed_fair_prob_reject_high` | 0.97 | Hard reject above (default 0.97) |
| `speed_fair_prob_reject_low` | 0.03 | Hard reject below (default 0.03) |
| `speed_late_30s_imbalance_reject` | 0.3 | Last-30s |fair − 0.5| reject threshold |
| `speed_cashout_late_30s_imbalance_reject` | 0.3 | Mirror for cashouts |
| `speed_cashout_late_reject_s` | 10 | Hard-reject cashouts in last N seconds |
| `speed_spread_pct` | 0.05 | Base 5% spread (per-market overrides) |
<!-- END: fees-pricing-internals -->

### Matrix pricing — statistical knobs

These are the knobs that govern the Bayesian-shrunk pricing matrix
(mig 0034). Tuning any of them requires a backtest.

<!-- BEGIN: fees-matrix-internals -->
| Key | Current | What it does |
|---|---|---|
| `speed_pricing_matrix_version` | 1 | Active matrix version (auto-set by cron) |
| `speed_pricing_matrix_min_n_eff` | 100 | Min effective N per cell |
| `speed_pricing_matrix_ci_max_width` | 0.12 | Max CI width before shrinking to BSM |
| `speed_pricing_matrix_prior_n` | 50 | Bayesian prior strength |
| `speed_entry_soft_block_threshold` | 0.95 | Soft-block trigger probability |
| `speed_entry_soft_block_unlock_threshold` | 0.94 | Soft-block hysteresis unlock |
| `speed_cashout_cap_edge_threshold` | 0.985 | Cashout cap-edge threshold |
<!-- END: fees-matrix-internals -->

### IV / volatility internals

<!-- BEGIN: fees-iv-internals -->
| Key | Current | What it does |
|---|---|---|
| `speed_iv_btc` | 0.6 | Fallback annualized BTC vol |
| `speed_iv_drift_tolerance_pct` | 0.1 | IV drift tolerance for stale-quote check |
<!-- END: fees-iv-internals -->

### Cashout margin coefficients (deprecated — per-market)

These rows are read-from-fallback only when no `speed_market_config` row
exists for the market. Today (BTC-5m, BTC-1m, GOLD-5m, GOLD-1m) all have
rows so these are dead weight; the per-market values inside
`/admin/markets-config → Advanced` are the active source.

<!-- BEGIN: fees-cashout-deprecated -->
| Key | Current | Read by |
|---|---|---|
| `speed_cashout_winning_base_5m` | 0.025 | Fallback only — per-market wins |
| `speed_cashout_winning_base_1h` | 0.03 | Fallback only |
| `speed_cashout_losing_base_5m` | 0.08 | Fallback only |
| `speed_cashout_losing_base_1h` | 0.09 | Fallback only |
| `speed_cashout_saturation_coef` | 0.2 | Fallback only |
| `speed_cashout_desperation_coef` | 0.4 | Fallback only |
| `speed_cashout_late_window_winning_coef` | 0.015 | Fallback only |
| `speed_cashout_late_window_losing_coef` | 0.05 | Fallback only |
<!-- END: fees-cashout-deprecated -->

### Stake caps (deprecated — per-market)

Same fallback-only story as cashout margins. Per-market values in
`/admin/markets-config` are the active source.

<!-- BEGIN: fees-stake-deprecated -->
| Key | Current | Read by |
|---|---|---|
| `speed_stake_max_5m_usd` | 25 | Fallback only — per-market wins |
| `speed_stake_max_1h_usd` | 50 | Fallback only |
| `speed_cap_per_side_usd` | 200 | Fallback only |
| `speed_stake_max_usd` | 25 | Legacy single-cap, fallback only |
<!-- END: fees-stake-deprecated -->

---

## /admin/markets-config — Advanced fields per market

These columns live in `speed_market_config` keyed by `(asset, duration)`.
Edit via the Advanced section in the admin UI, or via SQL:

```sql
UPDATE speed_market_config
   SET <column> = <value>
 WHERE asset = 'BTC' AND duration = '5m';
```

### Hidden columns (every active market)

20 fields per market, grouped by category:

- **Risk caps:** `per_side_pool_pct`, `per_user_open_exposure_pct`, `velocity_max_per_min`, `daily_handle_alert_usd`
- **Pricing — entry:** `spread_pct`, `soft_block_threshold`, `soft_block_unlock`, `late_window_60s_secs`, `late_window_30s_secs`, `late_window_60s_mult`, `late_window_30s_mult`, `last_n_reject_secs`, `near_decided_dist`
- **Cashout:** `cashout_winning_base`, `cashout_losing_base`, `cashout_saturation_coef`, `cashout_desperation_coef`, `cashout_late_winning_coef`, `cashout_late_losing_coef`, `cashout_reject_secs`, `cashout_late_30s_imbalance`, `cashout_cap_edge_threshold`
- **Matrix calibration:** `matrix_min_n_eff`, `matrix_ci_max_width`, `matrix_prior_n`, `matrix_calibration_window_days`

### Current values per market

<!-- BEGIN: markets-config-values -->
### BTC · 1m

| Field | Current |
|---|---|
| `per_side_pool_pct` | 0.10 |
| `per_user_open_exposure_pct` | 0.10 |
| `velocity_max_per_min` | 30 |
| `daily_handle_alert_usd` | 5000 |
| `spread_pct` | 0.08 |
| `soft_block_threshold` | 0.85 |
| `soft_block_unlock` | 0.84 |
| `late_window_60s_secs` | 30 |
| `late_window_30s_secs` | 15 |
| `late_window_60s_mult` | 1.20 |
| `late_window_30s_mult` | 1.40 |
| `last_n_reject_secs` | 3 |
| `near_decided_dist` | 0.30 |
| `cashout_winning_base` | 0.025 |
| `cashout_losing_base` | 0.08 |
| `cashout_saturation_coef` | 0.20 |
| `cashout_desperation_coef` | 0.40 |
| `cashout_late_winning_coef` | 0.015 |
| `cashout_late_losing_coef` | 0.05 |
| `cashout_reject_secs` | 3 |
| `cashout_late_30s_imbalance` | 0.30 |
| `cashout_cap_edge_threshold` | 0.985 |
| `matrix_min_n_eff` | 100 |
| `matrix_ci_max_width` | 0.12 |
| `matrix_prior_n` | 50 |
| `matrix_calibration_window_days` | 14 |

### BTC · 5m

| Field | Current |
|---|---|
| `per_side_pool_pct` | 1.00000000 |
| `per_user_open_exposure_pct` | 0.15000000 |
| `velocity_max_per_min` | 30 |
| `daily_handle_alert_usd` | 5000.00000000 |
| `spread_pct` | 0.05000000 |
| `soft_block_threshold` | 0.95000000 |
| `soft_block_unlock` | 0.94000000 |
| `late_window_60s_secs` | 60 |
| `late_window_30s_secs` | 30 |
| `late_window_60s_mult` | 1.20000000 |
| `late_window_30s_mult` | 1.40000000 |
| `last_n_reject_secs` | 10 |
| `near_decided_dist` | 0.30000000 |
| `cashout_winning_base` | 0.02500000 |
| `cashout_losing_base` | 0.08000000 |
| `cashout_saturation_coef` | 0.20000000 |
| `cashout_desperation_coef` | 0.40000000 |
| `cashout_late_winning_coef` | 0.01500000 |
| `cashout_late_losing_coef` | 0.05000000 |
| `cashout_reject_secs` | 10 |
| `cashout_late_30s_imbalance` | 0.30000000 |
| `cashout_cap_edge_threshold` | 0.98500000 |
| `matrix_min_n_eff` | 100 |
| `matrix_ci_max_width` | 0.12000000 |
| `matrix_prior_n` | 50 |
| `matrix_calibration_window_days` | 14 |

### GOLD · 1m

| Field | Current |
|---|---|
| `per_side_pool_pct` | 0.05 |
| `per_user_open_exposure_pct` | 0.05 |
| `velocity_max_per_min` | 30 |
| `daily_handle_alert_usd` | 5000 |
| `spread_pct` | 0.08 |
| `soft_block_threshold` | 0.85 |
| `soft_block_unlock` | 0.84 |
| `late_window_60s_secs` | 30 |
| `late_window_30s_secs` | 15 |
| `late_window_60s_mult` | 1.20 |
| `late_window_30s_mult` | 1.40 |
| `last_n_reject_secs` | 3 |
| `near_decided_dist` | 0.30 |
| `cashout_winning_base` | 0.025 |
| `cashout_losing_base` | 0.08 |
| `cashout_saturation_coef` | 0.20 |
| `cashout_desperation_coef` | 0.40 |
| `cashout_late_winning_coef` | 0.015 |
| `cashout_late_losing_coef` | 0.05 |
| `cashout_reject_secs` | 3 |
| `cashout_late_30s_imbalance` | 0.30 |
| `cashout_cap_edge_threshold` | 0.985 |
| `matrix_min_n_eff` | 100 |
| `matrix_ci_max_width` | 0.12 |
| `matrix_prior_n` | 50 |
| `matrix_calibration_window_days` | 30 |

### GOLD · 5m

| Field | Current |
|---|---|
| `per_side_pool_pct` | 0.05 |
| `per_user_open_exposure_pct` | 0.05 |
| `velocity_max_per_min` | 30 |
| `daily_handle_alert_usd` | 5000 |
| `spread_pct` | 0.04 |
| `soft_block_threshold` | 0.92 |
| `soft_block_unlock` | 0.91 |
| `late_window_60s_secs` | 60 |
| `late_window_30s_secs` | 30 |
| `late_window_60s_mult` | 1.20 |
| `late_window_30s_mult` | 1.40 |
| `last_n_reject_secs` | 10 |
| `near_decided_dist` | 0.30 |
| `cashout_winning_base` | 0.025 |
| `cashout_losing_base` | 0.08 |
| `cashout_saturation_coef` | 0.20 |
| `cashout_desperation_coef` | 0.40 |
| `cashout_late_winning_coef` | 0.015 |
| `cashout_late_losing_coef` | 0.05 |
| `cashout_reject_secs` | 10 |
| `cashout_late_30s_imbalance` | 0.30 |
| `cashout_cap_edge_threshold` | 0.985 |
| `matrix_min_n_eff` | 100 |
| `matrix_ci_max_width` | 0.12 |
| `matrix_prior_n` | 50 |
| `matrix_calibration_window_days` | 30 |
<!-- END: markets-config-values -->

---

## /admin/sharks — Manual override workflow

The CLV throttle (mig 0044) per-user shading lives in
`speed_user_edge_scores`. The `/admin/sharks` page surfaces edge scores
and the active shading state, but doesn't yet have an edit modal — the
proper override RPC + audit trail is on the roadmap.

Until then, two manual workflows:

### Pin a user's shading factor

```sql
UPDATE speed_user_edge_scores
   SET manual_shading_factor = 0.10,        -- pp shaded UP at trade-open
       manual_override_until = NOW() + INTERVAL '30 days',
       manual_override_reason = 'flagged sharp; 30-day shading review'
 WHERE user_id = '<uuid>';
```

The override expires at `manual_override_until`. When the nightly cron
runs, rows where `manual_override_until > NOW()` are skipped — so the
override survives recomputation.

### Exempt a user from shading

```sql
UPDATE speed_user_edge_scores
   SET manual_shading_factor = NULL,        -- NULL = bypass shading
       manual_override_until = NOW() + INTERVAL '30 days',
       manual_override_reason = 'exempt — confirmed casual'
 WHERE user_id = '<uuid>';
```

### Force a recompute

```sql
SELECT _speed_recompute_edge_scores();
```

Runs nightly at 04:00 UTC anyway; manual call is for debugging.

---

## Admin sidebar icon registry

Material Symbols Outlined names used in the sidebar. Document so future
icon swaps don't pick a non-existent name (which renders as text):

| Nav entry | Icon | Notes |
|---|---|---|
| Dashboard | `dashboard` | |
| Stats | `bar_chart` | |
| Speed Markets | `bolt` | |
| Users | `group` | |
| Sharks (CLV) | `gpp_maybe` | superadmin-gated |
| Money | `account_balance_wallet` | |
| Fees | `payments` | |
| Markets Config | `tune` | superadmin-gated |
| Help Center | `help` | |
| Admins | `shield_person` | superadmin-gated |

If you add a new entry, paste the icon name into a quick `<span
className="material-symbols-outlined">` test render before committing —
invalid names render as the literal string.
