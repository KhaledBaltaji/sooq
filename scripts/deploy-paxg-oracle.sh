#!/usr/bin/env bash
# scripts/deploy-paxg-oracle.sh
#
# Deploy the speed-oracle worker (services/speed-oracle/) to EC2 for the
# Phase 5A PAXG/USDT multi-asset rollout.
#
# What this script does:
#   1. SSH to the EC2 oracle host
#   2. Pull latest from origin/staging
#   3. cd to services/speed-oracle/, npm ci + npm run build
#   4. Restart the speed-oracle systemd service
#   5. Stream logs for 30 seconds so you can verify the multi-asset boot
#   6. Curl the /health endpoint to confirm both BTC and GOLD streams alive
#
# Pre-requisites on YOUR machine:
#   - SSH key at ~/.ssh/sooq-oracle.pem (chmod 400)
#   - The EC2 instance running at 63.183.214.217
#   - Code already pushed to origin/staging
#
# Pre-requisites on the EC2 instance (one-time setup):
#   - The repo cloned at /opt/speed-oracle (or wherever services/speed-oracle
#     lives — adjust REMOTE_REPO_PATH below if different)
#   - systemd unit speed-oracle.service exists and runs `node dist/index.js`
#   - Node 20+ installed
#   - DATABASE_URL + SENTRY_DSN exported in the systemd unit
#
# To activate gold (when ready):
#   1. ssh to RDS staging and run: UPDATE speed_assets SET enabled=TRUE WHERE id='GOLD';
#   2. Re-run this script — worker re-reads enabled assets at boot, picks up GOLD
#   3. UPDATE fee_config SET rate=1 WHERE fee_type='speed_gold_markets_enabled';
#
# Rollback:
#   bash scripts/deploy-paxg-oracle.sh --rollback
# (rolls EC2 back to previous git HEAD and restarts service)

set -euo pipefail

EC2_HOST="ec2-user@63.183.214.217"
SSH_KEY="${HOME}/.ssh/sooq-oracle.pem"
REMOTE_REPO_PATH="/opt/sooq"   # adjust to wherever the Sooq repo lives on EC2
SERVICE_NAME="speed-oracle"
HEALTH_URL_LOCAL="http://localhost:3000/health"  # health endpoint inside the worker

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn(){ echo -e "${YELLOW}[deploy]${NC} $*"; }
err() { echo -e "${RED}[deploy]${NC} $*" >&2; }

if [ ! -f "$SSH_KEY" ]; then
  err "SSH key not found at $SSH_KEY"
  exit 1
fi
chmod 400 "$SSH_KEY" 2>/dev/null || true

# ────────────────────────────────────────────────────────────────────
# Rollback path
# ────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--rollback" ]; then
  warn "ROLLBACK requested. Reverting EC2 to previous HEAD..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$EC2_HOST" bash <<EOF
set -e
cd $REMOTE_REPO_PATH
echo "[remote] current HEAD: \$(git rev-parse --short HEAD)"
git reset --hard HEAD~1
echo "[remote] reverted to: \$(git rev-parse --short HEAD)"
cd services/speed-oracle
echo "[remote] installing all deps (build needs devDeps)..."
npm ci --silent
echo "[remote] building TypeScript..."
npm run build
echo "[remote] pruning to production deps..."
npm prune --production --silent
sudo systemctl restart $SERVICE_NAME.service
sleep 3
sudo systemctl status $SERVICE_NAME.service --no-pager | head -20
EOF
  ok "Rollback complete. Worker restarted on previous commit."
  exit 0
fi

# ────────────────────────────────────────────────────────────────────
# Forward deploy
# ────────────────────────────────────────────────────────────────────

log "Connecting to $EC2_HOST..."

# Step 1: pull + build + restart on EC2
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$EC2_HOST" bash <<EOF
set -e
cd $REMOTE_REPO_PATH
echo "[remote] pre-pull HEAD: \$(git rev-parse --short HEAD)"
# Defensive: bail loudly if EC2 has local mods (P1-3 from /investigate)
if ! git diff-index --quiet HEAD --; then
  echo "[remote] FATAL: uncommitted local changes on EC2. Inspect with: git status"
  exit 1
fi
git fetch origin staging
git checkout staging
git pull --ff-only origin staging
echo "[remote] post-pull HEAD: \$(git rev-parse --short HEAD)"
echo "[remote] last commit: \$(git log -1 --oneline)"

cd services/speed-oracle
echo "[remote] installing deps..."
npm ci --production --silent

echo "[remote] building TypeScript..."
npm run build

echo "[remote] restarting $SERVICE_NAME service..."
sudo systemctl restart $SERVICE_NAME.service

# Give the service 5s to boot before we check status
sleep 5

echo "[remote] service status:"
sudo systemctl status $SERVICE_NAME.service --no-pager | head -15
EOF

ok "Deploy step complete. Streaming logs for 30s to verify multi-asset boot..."

# Step 2: stream logs for 30s so user can see boot output (asset subscriptions, etc.)
ssh -i "$SSH_KEY" "$EC2_HOST" "sudo journalctl -u $SERVICE_NAME.service -n 100 --since '1 minute ago' --no-pager" 2>&1 | tail -40

ok "Checking /health endpoint..."

# Step 3: curl /health from the EC2 host (worker listens on localhost:3000)
HEALTH_BODY=$(ssh -i "$SSH_KEY" "$EC2_HOST" "curl -s -m 5 $HEALTH_URL_LOCAL || echo '{}'")
echo "$HEALTH_BODY" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_BODY"

# Step 4: check connected status
if echo "$HEALTH_BODY" | grep -q '"connected":true'; then
  ok "Worker is connected and streaming."
  if echo "$HEALTH_BODY" | grep -q '"GOLD"'; then
    ok "GOLD asset is in the per_asset map. Gold ticks will flow when GOLD asset is enabled in DB."
  else
    warn "GOLD not in per_asset map. Either speed_assets.GOLD.enabled=FALSE or worker hasn't picked it up. To activate gold:"
    warn "  1. UPDATE speed_assets SET enabled=TRUE WHERE id='GOLD';"
    warn "  2. Re-run this script."
  fi
else
  err "Worker reports disconnected or unhealthy. Check journalctl on EC2."
  exit 1
fi

ok "Deploy complete. Tail full logs:"
echo "  ssh -i $SSH_KEY $EC2_HOST 'sudo journalctl -u $SERVICE_NAME.service -f'"
