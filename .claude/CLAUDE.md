# Claude Code Session Rules — Sooq Speed

## Identity
Real-money BTC fast-cycle prediction trading for the MENA region. Mistakes hit user wallets. Treat every database operation and deployment as if real money is at stake — because it will be.

## Hard Constraints
- **No production AWS access from local** — production RDS provisioned in W11 only via CI/CD pipeline.
- **No direct pushes to `main`** — production changes flow through PRs from `staging`.
- **Before any `git push`:** state branch + changes, wait for explicit user confirmation.
- **Before any commit:** run `npx tsc --noEmit` + `npm run lint` — both must exit 0.
- **Before any migration applies to staging or production:** explicit user confirmation.
- **NEVER** type credentials, access keys, OTP codes — the user pastes them themselves.
- **NEVER** create AWS / GitHub / Google accounts on the user's behalf.
- Migration changes that affect surviving tests require corresponding test updates.

## Multi-Session Safety
Multiple Claude Code sessions may run simultaneously on this repo.
- Before editing any file, check `.claude/sessions/locks/` for active locks (heartbeat < 2 hrs).
- Before creating any migration, reserve the number in `.claude/sessions/migrations/next.json`.
- See root `CLAUDE.md` "Multi-Session Safety" section for full rules.

## Bug Workflows
- **"Bug on staging"** → Full access (RDS staging available locally once W5 wires it). Fix → tests pass → commit → push (with approval).
- **"Bug on production/live"** → ZERO direct DB access. Fix on staging → PR to `main` (each step needs explicit approval).

## New Feature Flow
1. Read `CLAUDE.md` + `docs/ARCHITECTURE.md` + `docs/SPRINT_LOG.md` (latest entry).
2. Explore impacted code areas.
3. Ask the user about impact on existing flows (auth, speed RPC, money flow, admin).
4. Then `/plan-eng-review` if architecture-touching, or implement directly for small changes.

NEVER start implementing without understanding architecture first.

## Environment Quick Reference

| Env | Where | DB | Access |
|---|---|---|---|
| Local | `next dev` | Docker Postgres on dev workstation | Full |
| Staging | `staging.sooq.exchange` (Vercel preview) | RDS staging (W5+) | Full via `aws cli` after W5 |
| Production | `sooq.exchange` (Vercel) | RDS production multi-AZ (W11+) | CI/CD only, NEVER local |

## Rebuild Sprint (active)
- Plan: `~/.claude/plans/oh-my-how-much-giggly-crystal.md`
- Progress log: `docs/SPRINT_LOG.md`
- Current phase: see latest "Phase boundary checkpoint" in SPRINT_LOG.
- LMSR / branches / commission / demo / prelaunch are all stripped — do not re-add without a fresh spec.
