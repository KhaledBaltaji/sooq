# DEPRECATED — historical Supabase migrations

These SQL files were applied to the original Supabase Postgres instance
during the prediction-market era and the W1–W6 strip. They are kept for
historical reference only.

## Source of truth is now Drizzle

- Schema lives in [`src/lib/db/schema.ts`](../../src/lib/db/schema.ts).
- New migrations go in [`drizzle/migrations/`](../../drizzle/migrations/),
  generated via `npx drizzle-kit generate`.
- Applied to RDS via `npm run db:migrate`.

## Do not

- Add new SQL files here.
- Run these against AWS RDS (most are already applied; many are obsolete
  after the W2/W3/W4 strip).
- Reference these from new code or docs.

## Cleanup status

This folder is being trimmed as obsolete migrations are confirmed dead.
Latest count and full deprecation date are tracked in
[`docs/SPRINT_LOG.md`](../../docs/SPRINT_LOG.md).
