# Security audit — 2026-05-11

Pre-launch hardening Steps 4 + 8. Read-only audit of the trade and
settlement RPCs. Findings short-form so a future Claude session can
re-verify after any change to these functions.

---

## Step 4 — Settlement double-pay race

**Functions reviewed:**
- `public.speed_resolve_market(p_market_id uuid)` (368 lines)
- `public._speed_update_daily_ngr(p_stake_in, p_payout_out, p_cashout_out, p_refund_out)` (54 lines)
- File pointers: `drizzle/functions/speed_resolve_market.sql`,
  `drizzle/functions/_speed_update_daily_ngr.sql`

**Triple-locked defense:**

1. **Advisory transaction lock** (line 57)
   `pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT))`.
   Two concurrent invocations on the same market: only one wins the
   lock. Loser returns `{ skipped: true, reason: 'Another invocation is
   already resolving this market' }` and the transaction commits as a
   no-op.

2. **Status guard at entry** (line 66–68)
   `IF v_market.status NOT IN ('open','resolving') THEN RETURN
   { skipped, status }`. Even if the advisory lock is released between
   commits (xact-scoped), a third invocation hits a market already in
   'resolved' or 'voided' status and exits without touching balances.

3. **Per-position settlements idempotency** (line 145–146 and 299–300)
   Before paying any position, the loop checks
   `SELECT * INTO v_existing FROM speed_settlements WHERE position_id =
   v_pos.id; IF FOUND THEN CONTINUE;`. The `speed_settlements` row is
   inserted as the LAST step of each iteration. If the function ever
   re-enters with a partial settlement (status='resolving' from a prior
   crash), already-paid positions are skipped.

**Status update guard:** the final `UPDATE speed_markets SET status =
'resolved'` is inside the advisory lock + after per-position settlement
inserts. A crash between the settlements and the market UPDATE leaves
the market in 'resolving' status with full settlements rows; re-running
the function skips every position (idempotency check) and only
re-attempts the market UPDATE + the NGR write.

**NGR accumulation idempotency:** `_speed_update_daily_ngr` uses
`INSERT ... ON CONFLICT (ngr_date) DO UPDATE SET stake_in = stake_in
+ EXCLUDED.stake_in` etc. Called from inside the same transaction as
the resolve. If the resolve transaction commits twice (impossible
under the advisory lock), NGR would double-count — but the lock
prevents this.

**Edge cases considered:**
- pg_cron firing the cron handler twice for the same market in
  overlapping intervals → advisory lock blocks the second.
- A 3-second crash between the per-position loop and the market UPDATE
  → on next cron tick, status='resolving' passes the guard, all
  positions skip via idempotency, market UPDATE re-runs, NGR write
  re-runs (and accumulates a zero-stake update on the daily row).
- Two different markets resolving simultaneously → different advisory
  lock hash keys, both proceed. NGR INSERT ... ON CONFLICT handles
  concurrent same-day writes correctly.

**Conclusion:** No double-pay race identified. The defense is layered;
each layer alone would prevent double-pay; together they survive any
realistic crash/retry sequence.

**Belt-and-suspenders suggestion (not done now):** add `UNIQUE
CONSTRAINT speed_settlements_position_id_uniq UNIQUE (position_id)`.
If the position_id PK doesn't already enforce uniqueness, a UNIQUE
constraint would make the per-position idempotency a DB-level
guarantee instead of an application check. Defer to a future
migration.

---

## Step 8 — SQL injection audit

**Functions reviewed:**
- `public.speed_execute_trade(p_market_id uuid, p_side text, p_stake
  numeric, p_idempotency_key text, p_expected_iv numeric, p_expected_spot
  numeric, p_expected_seconds_left_bucket integer, p_expected_fair_prob
  numeric, p_expected_offered_prob numeric)` (518 lines)
- `public.speed_execute_cashout(p_position_id uuid, p_idempotency_key
  text, p_expected_iv numeric, p_expected_spot numeric,
  p_expected_seconds_left_bucket integer, p_expected_mark_prob numeric,
  p_expected_cashout_amount numeric)` (327 lines)

**Search performed:**
```
grep -nE '(EXECUTE|format\(|\|\|.*\|\|)' drizzle/functions/speed_execute_trade.sql drizzle/functions/speed_execute_cashout.sql
```

**Findings:**

1. **No `EXECUTE` statements (no dynamic SQL).** All queries are
   static; parameters bind via PL/pgSQL implicit variable binding or
   named placeholders. No string-built SQL anywhere.

2. **`format()` calls** (5 occurrences in trade RPC) — used ONLY for
   `RAISE EXCEPTION USING HINT = format(...)` messages. Not SQL-context;
   format strings + numeric values formatted for user-visible error
   text. Safe.

3. **String concatenations to TEXT columns** (3 sites total):
   - `speed_execute_trade.sql:490`
     `'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' ||
     v_market.duration` — stored in `transactions.description`.
     `p_side` is whitelist-validated at line 93 (`IF p_side NOT IN
     ('over','under') THEN RAISE`) AND cast to the `speed_side` enum at
     all DB-relevant uses (lines 196, 427, 450, 467). `v_market.asset`
     and `v_market.duration` come from the `speed_markets` row whose
     types are enums (speed_asset, speed_duration). All bounded.
     Even if a bad string reached this concat, it lands in a TEXT
     column verbatim — not in a SQL-execution context.
   - `speed_execute_cashout.sql:301–303` — concat of NUMERIC
     `v_margin` and `v_pct` values (rounded). Stored in
     `transactions.description`. Safe.
   - `speed_resolve_market.sql:330` — `'Speed payout (' || v_pos.side
     || ')'`. `v_pos.side` is the `speed_side` enum from
     `speed_positions`. Bounded.

**Parameter handling:**
- `p_market_id uuid` / `p_position_id uuid` — Postgres type-checks at
  call entry; non-UUID input raises.
- `p_stake numeric`, `p_expected_*` numeric/integer — type-checked.
- `p_side text` — whitelist-checked + enum-cast (see above).
- `p_idempotency_key text` — used ONLY as parameter in
  `WHERE t.idempotency_key = p_idempotency_key` and as INSERT VALUE.
  Never concatenated into SQL.

**Conclusion:** No SQL injection vectors. All user input is either
type-bound by PG, whitelist-validated, or limited to inert TEXT-column
storage.

---

## Re-audit triggers

Re-run both audits if:
- Any new `CREATE OR REPLACE FUNCTION speed_execute_*` migration ships.
- `_speed_update_daily_ngr` signature changes.
- `speed_resolve_market` is modified.
- Anyone adds `EXECUTE` or `format()`-with-SQL to any function in
  `drizzle/functions/`.

The `extract-functions.mjs` step (auto-run by `apply-mig.mjs`) refreshes
the canonical files on every apply; the canonical file is the input to
this audit.
