# Deploy Runbook — Sooq

How to ship code from your laptop to `staging.sooq.exchange` (and, later,
to `sooq.exchange`). One page. Read top to bottom the first time, skim
the section you need after that.

---

## Environments at a glance

| Env | Branch | Vercel project | DB |
|---|---|---|---|
| Local | any | `next dev` on `localhost:3000` | Docker Postgres or RDS via `.env.local` |
| Staging | `staging` | Vercel auto-deploy → `staging.sooq.exchange` | RDS `sooq-staging-db` (eu-central-1) |
| Production | `main` | (W11/W12) | RDS prod multi-AZ (W11/W12) |

Vercel functions are pinned to `fra1` (Frankfurt) so they sit in the same
region as RDS. See [`vercel.json`](../vercel.json).

---

## Ship a code-only change to staging

Code-only = no schema changes, no new migration in `drizzle/migrations/`.

```bash
# 1. On your laptop, on the staging branch
git checkout staging
git pull --ff-only origin staging

# 2. Make changes, commit
git add <files>
git commit -m "WXX <area>: <what>"
#   pre-commit hook runs `tsc --noEmit` and blocks on type errors.

# 3. Push
git push origin staging
#   - GitHub Actions runs lint + tsc on the staging branch.
#   - Vercel auto-deploys to staging.sooq.exchange (~2-3 min build).

# 4. Verify
#   - https://staging.sooq.exchange/api/health → 200 + "healthy"
#   - Watch Sentry (env: preview) for new errors.
#   - Slack #sooq-alerts fires on health-check 503.
```

---

## Ship a migration to staging

When you change `src/lib/db/schema.ts`:

```bash
# 1. Generate the migration
npx drizzle-kit generate
#   Drops a new file in drizzle/migrations/<NNNN>_<auto-name>.sql
#   and updates drizzle/migrations/meta/_journal.json.

# 2. Inspect the generated SQL — Drizzle is good but not perfect.
#   Hand-edit if needed (RPC bodies, custom indexes, SECURITY DEFINER, etc.).

# 3. (Optional) Check what's pending against staging RDS
npm run db:migrate:status

# 4. Apply to staging RDS
npm run db:migrate
#   Idempotent — uses drizzle.__drizzle_migrations to skip what's done.

# 5. Commit and push as a code-only change.
git add drizzle/migrations/ src/lib/db/schema.ts
git commit -m "WXX db: <what changed> (mig <NNNN>)"
git push origin staging
```

**Do not** add a new `scripts/apply-*.mjs` file. The 14 existing ones are
historical; new migrations go through `npm run db:migrate`.

---

## Apply pending migrations from a fresh clone

If you just cloned the repo or switched machines:

```bash
cp .env.local.example .env.local
# Edit .env.local — fill DATABASE_URL with the staging RDS string from
# AWS Secrets Manager (see docs/AWS_RESOURCES.md).

npm install                  # installs deps + git hooks via postinstall
npm run db:migrate:status    # see what's pending
npm run db:migrate           # apply pending migrations
```

---

## Rollback

There is no automated rollback. Pick the right one for what broke.

### Code is broken (no schema change)

```bash
# 1. Find the offending commit
git log --oneline -10

# 2. Revert it
git revert <sha>
git push origin staging
#   Vercel will redeploy automatically.
```

Or use Vercel's "Promote" UI on a previous deployment if the next CI run
takes too long and you need to roll back in seconds.

### Migration is broken

There is no clean rollback for a forward-only migration. Options:

1. **Write a new migration that reverses the change** (preferred).
   `git checkout -b fix/revert-mig-NNNN` → write new migration → apply →
   ship.
2. **Manual SQL on staging RDS** for emergency only — use `psql` and
   document what you did in `docs/SPRINT_LOG.md`. Do **not** edit the
   already-applied migration file (Drizzle will think it's still
   applied and skip the corrected version).

---

## Production cutover (W11/W12 — placeholder)

This runbook covers staging only. Production cutover requires:

- A second Vercel project with the `sooq.exchange` domain attached.
- Multi-AZ production RDS in `eu-central-1`.
- The CI workflow gating PRs from `staging` → `main` (already configured
  for `main`, see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
- A DNS swap plan.
- Production env vars set in the new Vercel project.

The full plan lives in `~/.claude/plans/oh-my-how-much-giggly-crystal.md`
under W11/W12. Update this section once cutover is done.

---

## Where things live

| Concern | File |
|---|---|
| Vercel config (region, headers via Next) | [`vercel.json`](../vercel.json), [`next.config.ts`](../next.config.ts) |
| CI gate | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| Drizzle config | [`drizzle.config.ts`](../drizzle.config.ts) |
| Schema (source of truth) | [`src/lib/db/schema.ts`](../src/lib/db/schema.ts) |
| Migrations | [`drizzle/migrations/`](../drizzle/migrations/) |
| Migration applier | [`scripts/db-migrate.mjs`](../scripts/db-migrate.mjs) |
| Pre-commit / pre-push hooks | [`scripts/hooks/`](../scripts/hooks/) (installed via `postinstall`) |
| Health check | [`src/app/api/health/route.ts`](../src/app/api/health/route.ts) |
| AWS infra inventory | [`docs/AWS_RESOURCES.md`](AWS_RESOURCES.md) |
| Speed mode operational notes | [`docs/speed-runbook.md`](speed-runbook.md) |
| Sprint progress log | [`docs/SPRINT_LOG.md`](SPRINT_LOG.md) |

---

## Useful commands

```bash
# Health check (against staging)
curl https://staging.sooq.exchange/api/health | jq

# Health check (local against your DATABASE_URL)
curl http://localhost:3000/api/health | jq

# What migrations are pending against staging RDS?
npm run db:migrate:status

# Strip preview env (one-time after adding a new env var)
node scripts/strip-preview-env.mjs

# Tail Vercel logs
vercel logs --follow

# Connect to staging RDS via psql
psql "$DATABASE_URL"
```
