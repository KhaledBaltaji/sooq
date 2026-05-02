# Claude Code Session Rules — Prediction Market

## Identity
This is a real-money fintech prediction market. Mistakes hit user wallets. Treat every database operation and deployment as if real money is at stake — because it will be.

## Hard Constraints
- Production project ref: `dwpizrhtyrquhibqcuuu` — NEVER link, NEVER push, NEVER query locally
- Staging project ref: `zzebptrztuwnqlxxmjuo` — the ONLY project Claude may interact with locally
- Before any `supabase` CLI command: verify linked project via `cat supabase/.temp/project-ref`
- Before any `git push`: state branch + changes, wait for user confirmation
- Before any commit: run `npm test` (all must pass) + `npx tsc --noEmit`
- Migration changes require corresponding test updates

## Multi-Session Safety
Multiple Claude Code sessions may run simultaneously on staging.
Before editing any file, you MUST check `.claude/sessions/locks/` for conflicts.
Before creating any migration, you MUST reserve the number in `.claude/sessions/migrations/next.json`.
See root CLAUDE.md "Multi-Session Safety Protocol" for full rules. This is mandatory, not optional.

## Bug Workflows
- **"Bug on staging"** → Full access. Fix directly, test, commit, push (with approval).
- **"Bug on production/live"** → ZERO direct access. Fix on staging → PR to main (each step needs approval).

## New Feature Flow
1. Read architecture first (CLAUDE.md, build-plan-v3, commission-model, memory files)
2. Explore impacted code areas
3. Ask questions about impact on existing workflows
4. Then `/ceo` → `/engineering` → implement
- NEVER start implementing without understanding the architecture first.

## Environment Quick Reference
| Env | Project ref | Access |
|---|---|---|
| Staging | `zzebptrztuwnqlxxmjuo` | Full (local CLI, can wipe) |
| Production | `dwpizrhtyrquhibqcuuu` | CI/CD only, NEVER local |
