#!/usr/bin/env bash
# Auto-rotate staging.sooq.exchange to the latest READY deployment after a
# successful `git push origin staging`. Spawned by the PostToolUse hook
# in .claude/settings.json — runs detached so the harness doesn't block.
#
# Strategy:
#   1. Capture the URL the alias currently points at (so we can detect
#      "new deploy is up" vs "still showing the previous build").
#   2. Poll `vercel ls sooq --meta githubCommitRef=staging` every 20s
#      for up to 6 minutes, watching the top READY entry.
#   3. As soon as a READY URL appears that differs from the pre-push URL,
#      run `vercel alias set <url> staging.sooq.exchange`.
#   4. Append every step to ~/.claude/vercel-alias-staging.log so failures
#      are recoverable without re-running the push.
#
# Manual override: `vercel alias set <url> staging.sooq.exchange` still
# works the old way; this script just removes the round-trip when push
# is the trigger.

set -u

LOG="$HOME/.claude/vercel-alias-staging.log"
SENTINEL="$HOME/.claude/vercel-alias-staging.RECOVERY-NEEDED"
PROJECT="sooq"
ALIAS="staging.sooq.exchange"
# T4.3: bumped 360s → 600s. Observed ~7min build time on T0/T1 deploys
# (CI + Vercel + Next.js compile). 360s gave up before the new deploy
# was READY, leaving the alias stuck on the old build until manual fix.
TIMEOUT_S=600
POLL_S=20

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG"
}

# vercel ls output: status column contains "● Ready". Third column is the
# deployment URL. Anchor on Ready and pull the URL field reliably.
latest_ready_url() {
  vercel ls "$PROJECT" --meta githubCommitRef=staging 2>/dev/null \
    | awk '/Ready/ { for (i=1;i<=NF;i++) if ($i ~ /^https:\/\//) { print $i; exit } }'
}

current_alias_target() {
  vercel inspect "$ALIAS" 2>/dev/null \
    | awk '/^[[:space:]]*url[[:space:]]+/ { print $2; exit }'
}

mkdir -p "$(dirname "$LOG")"

PRE_PUSH_URL="$(latest_ready_url || true)"
log "trigger received; pre-push READY url=${PRE_PUSH_URL:-<none>}"

# Wait for a NEWER READY deployment to appear. Newer = different URL than
# the one we observed at trigger time.
deadline=$(( $(date +%s) + TIMEOUT_S ))
NEW_URL=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  candidate="$(latest_ready_url || true)"
  if [ -n "$candidate" ] && [ "$candidate" != "$PRE_PUSH_URL" ]; then
    NEW_URL="$candidate"
    break
  fi
  sleep "$POLL_S"
done

if [ -z "$NEW_URL" ]; then
  log "FAILED: no new READY deployment within ${TIMEOUT_S}s — alias unchanged"
  # T4.4: drop a sentinel file the next session start can check. It carries
  # the pre-push URL so a recovery script knows what state we were in. If a
  # newer READY deployment shows up after we gave up, the next session can
  # rotate without needing the user to re-trigger a push.
  printf 'pre_push_url=%s\ngave_up_at=%s\n' \
    "${PRE_PUSH_URL:-}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$SENTINEL"
  exit 1
fi

log "new READY url=$NEW_URL — running alias set"
if vercel alias set "$NEW_URL" "$ALIAS" >> "$LOG" 2>&1; then
  log "OK: $ALIAS now points at $NEW_URL"
  # Clear any prior recovery sentinel — we're good now.
  rm -f "$SENTINEL"
  exit 0
else
  log "FAILED: vercel alias set returned non-zero — manual fix required"
  printf 'pre_push_url=%s\nfailed_url=%s\nfailed_at=%s\n' \
    "${PRE_PUSH_URL:-}" "$NEW_URL" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$SENTINEL"
  exit 1
fi
