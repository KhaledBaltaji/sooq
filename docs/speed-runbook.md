# Speed Markets — Operational Runbook

This is a fire-drill checklist for ops when something looks wrong with the speed-markets product. Each section is "if you see X, do Y." Keep this short. If you find yourself adding paragraphs, you're doing it wrong.

**Dashboard:** `/admin/speed-overview` shows the `monitoring` section added in mig 360. Watch the four panels: pool balance, RV cache, late-window today, kill switches.

**Baseline:** Pool currently at `~$9,930`. Cap rejects on either side at 40% of pool = `$3,972` worst-case payout liability per market.

---

## Critical alerts

### "Pool drained / negative balance"

If `main_pool_balance < $1,000` or trending negative:

1. **Halt all new bets immediately:**
   ```sql
   UPDATE fee_config SET rate = 0 WHERE fee_type = 'speed_markets_enabled';
   ```
2. Existing positions resolve normally (this is a soft kill — refunds, payouts, and resolutions still work).
3. Investigate before re-enabling. Check `speed_pool_ledger` for the largest recent payouts; identify the pattern.
4. **Re-enable only after** verifying the pool can absorb expected daily flow. To re-enable:
   ```sql
   UPDATE fee_config SET rate = 1 WHERE fee_type = 'speed_markets_enabled';
   ```

### "Exposure cap rejecting too many trades"

If users complain about `Market exposure cap reached` errors more than ~5% of attempts:

1. Check pool balance. If `< $5,000`, top up the main pool first.
2. Check `monitoring.late_window_today.pct_of_total_trades` — high % means users are clustering on one side.
3. **Don't raise the 40% cap.** That cap is the only thing protecting the pool from concentrated flow. Top up pool instead.

### "Users report 'rigged' losses"

If multiple users complain a clear winning bet lost:

1. Pull the resolved market: `SELECT * FROM speed_markets WHERE id = ...`
2. Check `settlement_price` vs `strike_price` and `twap_window_end` (the actual tick used).
3. If the tick is more than 1s before close, oracle worker may have stalled. Check Railway logs.
4. If settlement is technically correct but feels wrong to the user — that's a UX issue, not a math bug. Refer them to support.

### "Markets voiding back-to-back" (oracle worker silent)

If 2+ markets void in a row with reason `No oracle tick available within 2s before closes_at`, the Railway worker is not writing ticks.

1. **Check the worker health endpoint:** `curl -sS https://speed-oracle-production.up.railway.app/health | jq`
   - `healthy: true` and `last_tick_age_sec: 0-1` → worker is fine, the void was a one-off.
   - `healthy: false` and `connected: true` and `last_tick_age_sec > 5` → **zombie WebSocket**. The watchdog (added 2026-04-29) should kick in within 10s and reconnect. If `reconnect_attempts: 0` for >30s after this state, watchdog is broken.
   - `healthy: false` and `connected: false` → WebSocket disconnected, reconnect path running. Should self-heal within 30s.
   - HTTP request fails entirely → process is down. Railway should restart on `ON_FAILURE`.

2. **If the worker is zombied or down longer than 60s:**
   ```bash
   cd services/speed-oracle && railway redeploy --service speed-oracle --yes
   ```
   Or click **Redeploy** in the Railway dashboard. Process restarts in ~30s, reconnects to Binance immediately.

3. **Confirm recovery:** poll the health endpoint until `healthy: true` and `ticks_since_start` is incrementing. Then check DB:
   ```sql
   SELECT MAX(ts) FROM speed_oracle_ticks WHERE asset = 'BTC';
   ```
   Should be within 2 seconds of `NOW()`.

4. **Voided markets stay voided** — refunds already issued. Don't try to "un-void" them. Mig 355 doing its job.

---

## RV cache health

`monitoring.rv_cache.status` panel:

| Status | What it means | Action |
|---|---|---|
| `fresh` | Cache < 90s old | Nothing — healthy |
| `stale` | 90-300s old | Refresh job (`speed_rv_refresh()` pg_cron) is lagging. Check pg_cron logs. Trades fall back to static IV in this state — still safe but less accurate. |
| `very_stale` | > 5 min old | Refresh broken. Investigate `pg_cron.job_run_details` for failures. |
| `missing` | Cache empty | First-time bootstrap or DB reset. Run `SELECT speed_rv_refresh();` manually. |

**To force a manual refresh:**
```sql
SELECT speed_rv_refresh();
SELECT computed_at FROM speed_realized_vol_cache WHERE asset = 'BTC';
```

**To disable RV entirely (kill switch):**
```sql
UPDATE fee_config SET rate = 0 WHERE fee_type = 'speed_use_realized_vol';
```
This makes `_speed_get_iv` always return the static `speed_iv_btc` value (default 0.6). Trades and cashouts continue working with degraded accuracy.

---

## Kill switches reference

All three switches are in `fee_config`. Read state from `monitoring.kill_switches` in admin overview.

| Switch | What it disables | When to use |
|---|---|---|
| `speed_markets_enabled = 0` | All new bets (open positions resolve normally) | Emergency halt: pool drain, suspected exploit, regulatory issue |
| `speed_use_realized_vol = 0` | Live volatility — falls back to static IV=0.6 | RV refresh broken; pricing OK with static IV |
| `speed_late_window_surcharge = 0` | Late-window 15% spread surcharge | Users complaining brutal late cashouts; want to test without it |
| `speed_late_window_threshold = 0` | Same as above (effectively disables surcharge) | Alternative to setting surcharge to 0 |

Toggle via:
```sql
UPDATE fee_config SET rate = <0 or 1> WHERE fee_type = '<switch_name>';
```

Changes take effect on the next trade RPC call. No restart needed.

---

## Late-window surcharge monitoring

`monitoring.late_window_today` panel shows trades placed in the last 30 seconds of any market today.

| `pct_of_total_trades` | Meaning |
|---|---|
| 0% | Users haven't discovered late betting yet (early launch is normal) |
| 1-5% | Some users tap late, surcharge is silently doing its job |
| 5-15% | Real late-window adoption. Surcharge revenue showing in `estimated_extra_revenue` |
| > 20% | Significant late-window flow. Watch the cashout pattern — exploit attempts? |

If late-window % spikes suddenly, check Telegram/social for any "wait until last 10 seconds" exploit chatter.

---

## Migration rollback procedures

All migrations 353-360 are forward-only. To roll back, you'd revert the function bodies via a new migration that copies the prior version's body. Check `supabase/migrations/` for the previous mig that defined the function (e.g., mig 351 had the prior `speed_execute_cashout` body before mig 354+356+358 took over).

**Hot rollback via kill switches** (preferred — no migration needed):

| If broken | Kill switch | Effect |
|---|---|---|
| Late-window surcharge math | `speed_late_window_surcharge = 0` | Surcharge stops applying. Spread reverts to base 4% + Seam 3 widening. |
| RV pricing | `speed_use_realized_vol = 0` | Falls back to static IV=0.6 |
| Anything serious | `speed_markets_enabled = 0` | All new bets halted |

**Hard rollback** (only if hot rollback insufficient): write a new migration restoring the prior function body. Reference the migration that introduced the broken behavior:
- Mig 353-356: pricing engine changes
- Mig 357: fair_prob clip tightening
- Mig 358: cashout role tie-break
- Mig 359: format() string fix
- Mig 360: monitoring (low risk, safe to leave in place)

---

## Daily ops checks (5 min)

1. Open `/admin/speed-overview`
2. Verify `master_enabled: true`
3. Verify `rv_cache.status = "fresh"`
4. Verify `main_pool_balance > $5K` (top up if not)
5. Glance at `today_effective_edge_pct` — should be in `[2%, 8%]` range. Outside that = something's off.
6. Check `late_window_today.pct_of_total_trades` — if it spikes day-over-day, investigate.

If all five pass: speed markets are healthy.

---

## Useful diagnostic queries

**Recent trades on a specific market:**
```sql
SELECT t.created_at, t.kind, t.amount, t.fair_prob, t.offered_prob, t.handle_fee
FROM speed_trades t
WHERE market_id = '<uuid>'
ORDER BY created_at DESC LIMIT 20;
```

**Per-market exposure right now:**
```sql
SELECT
  side,
  COUNT(*) AS positions,
  SUM(stake) AS total_stake,
  SUM(stake / entry_offered_prob) AS payout_liability
FROM speed_positions
WHERE market_id = '<uuid>' AND status = 'open'
GROUP BY side;
```

**Pool ledger reconciliation (sanity check):**
```sql
SELECT
  (SELECT speed_pool_balance FROM speed_main_pool_state WHERE id = 1) AS sentinel_balance,
  (SELECT SUM(amount) FROM speed_pool_ledger WHERE branch_id IS NULL) AS ledger_sum_main;
-- These should match exactly post-mig 345.
```

**Cap rejection trace** (look at recent system_logs if any):
```sql
SELECT created_at, severity, source, message
FROM system_logs
WHERE source LIKE 'speed%' AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC LIMIT 50;
```

---

## When to wake up the team

Page someone if:
- `master_enabled = false` and you didn't expect it
- `main_pool_balance < $2,000`
- `today_effective_edge_pct < 0%` (house losing money)
- More than 10 distinct users complain about settlement in 1 hour
- Realtime channels (`/api/health` returns degraded for >5 min)

Don't page for:
- Single user complaint about late-window cashout being brutal (that's by design)
- RV cache stale for < 5 min (cache will refresh)
- One-off cap rejection (the cap is doing its job)
