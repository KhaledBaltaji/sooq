# Cron Signal-Lost Audit — 2026-04-18

## Context

The `/api/cron/check-errors` endpoint filtered `reconcile_branch_solvency()` output by a nonexistent column name (`discrepancy`). The real columns are `difference` and `pool_difference`. Until commit f7b198b landed the fix, any branch solvency drift went unalerted. During the W1-C audit a $10K+ drift slipped through without firing Slack.

This doc is the scratchpad for running `scripts/audits/cron-signal-lost-audit.sql` and recording what the lost window hid.

## How to run

```sh
# 1. Verify staging link
cat supabase/.temp/project-ref   # MUST show zzebptrztuwnqlxxmjuo

# 2. Pipe psql output back into this file under "Results"
supabase db remote commit || true
psql "$(supabase status --linked | grep 'DB URL' | awk '{print $3}')" \
  -f scripts/audits/cron-signal-lost-audit.sql \
  > /tmp/signal-lost.txt
cat /tmp/signal-lost.txt

# 3. Copy the relevant output into the sections below.
```

## Regression prevention

Migration 263 and below land a fix for the immediate bug via the test at
`src/tests/db/concurrency.test.ts` scenario 8 (`cron-filter-reconcile-branch-solvency`).
That test seeds a branch with a deliberate mismatch and asserts the cron's
`Math.abs(row.pool_difference) > 10` filter would match — so if anyone
renames the reconcile output columns again, the test fails loudly.

## Results — Staging

### Section 1 — Current reconciliation state

_(fill in after running the audit — copy the CURRENT_RECONCILE rows here)_

### Section 2 — system_logs rows previously missed

_(fill in — list each MISSED_LOG row, sorted by pool_diff magnitude)_

### Section 3 — Top lost-signal events (last 60d)

_(fill in — TOP_LOST_SIGNAL rows, focus on pool_diff > $100)_

### Section 4 — W1-C candidates

_(fill in — W1C_CANDIDATE rows, cross-reference with the original audit notes)_

### Section 5 — Agent balance drift (newly wired)

_(fill in — AGENT_BALANCE_DRIFT rows; this was never run before f7b198b)_

### Section 6 — Summary counts

_(fill in — SUMMARY row: missed_alerts_30d, max_missed_drift_usd_30d)_

## Results — Production

Do NOT run from Claude Code. Ops runs this locally after verifying prod link,
then copies the output here.

_(awaiting ops run)_

## Action items

- [ ] Run the audit on staging (`supabase db remote commit` first if any local drift)
- [ ] Resolve any CURRENT_RECONCILE rows with drift > $10 (manual reconciliation via admin panel)
- [ ] Run the audit on production (ops-owned workflow)
- [ ] If any drift > $1000 found, flag for deeper investigation — may require journal-entry adjustment
- [ ] Close the ticket once both environments are clean
