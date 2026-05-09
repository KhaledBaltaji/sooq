#!/usr/bin/env bash
# scripts/deploy-paxg-oracle.sh
#
# Deploy the speed-oracle worker (services/speed-oracle/) to EC2 for the
# Phase 5A PAXG/USDT multi-asset rollout.
#
# Layout per docs/AWS_RESOURCES.md:
#   - EC2 box runs `/opt/speed-oracle/dist/index.js` via systemd
#   - It is an RSYNC TARGET, not a git checkout
#   - `/etc/speed-oracle.env` is owned by root; never touched by deploy
#   - SG `sg-0a4270ac6977f474a` must allow YOUR ip on port 22 (+ 3000 for /health)
#
# Flow:
#   1. Local: npm ci + npm run build inside services/speed-oracle/
#   2. Snapshot remote /opt/speed-oracle/ → /opt/speed-oracle.bak/ (atomic rollback)
#   3. Rsync dist/, node_modules/, package.json to /opt/speed-oracle/
#   4. systemctl restart speed-oracle.service
#   5. Stream logs (30s) + curl /health
#
# Rollback:
#   bash scripts/deploy-paxg-oracle.sh --rollback
#   (swaps .bak back into place + restart)

set -euo pipefail

EC2_HOST="ec2-user@63.183.214.217"
SSH_KEY="${HOME}/.ssh/sooq-oracle.pem"
REMOTE_DIR="/opt/speed-oracle"
REMOTE_BAK="/opt/speed-oracle.bak"
SERVICE_NAME="speed-oracle"
HEALTH_URL_LOCAL="http://localhost:3000/health"
LOCAL_WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)/services/speed-oracle"

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

# ────────────────────────────────────────────────────────────────────
# Pre-flight
# ────────────────────────────────────────────────────────────────────

if [ ! -f "$SSH_KEY" ]; then
  err "SSH key not found at $SSH_KEY"
  exit 1
fi
chmod 400 "$SSH_KEY" 2>/dev/null || true

if [ ! -d "$LOCAL_WORKER_DIR" ]; then
  err "Local worker dir not found: $LOCAL_WORKER_DIR"
  exit 1
fi

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

# ────────────────────────────────────────────────────────────────────
# Rollback path
# ────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--rollback" ]; then
  warn "ROLLBACK requested. Swapping $REMOTE_BAK -> $REMOTE_DIR ..."
  ssh "${SSH_OPTS[@]}" "$EC2_HOST" bash <<EOF
set -e
if [ ! -d $REMOTE_BAK ]; then
  echo "[remote] FATAL: no backup at $REMOTE_BAK"
  exit 1
fi
sudo systemctl stop $SERVICE_NAME.service || true
sudo rm -rf ${REMOTE_DIR}.failed 2>/dev/null || true
sudo mv $REMOTE_DIR ${REMOTE_DIR}.failed
sudo mv $REMOTE_BAK $REMOTE_DIR
sudo systemctl start $SERVICE_NAME.service
sleep 3
sudo systemctl status $SERVICE_NAME.service --no-pager | head -15
EOF
  ok "Rollback complete. Worker restarted from previous snapshot."
  exit 0
fi

# ────────────────────────────────────────────────────────────────────
# 1. Local build
# ────────────────────────────────────────────────────────────────────

log "Building worker locally in $LOCAL_WORKER_DIR ..."
cd "$LOCAL_WORKER_DIR"

# Full deps for build (devDeps include tsc)
npm ci --silent

# Compile TS -> dist/
npm run build

# Prune to production deps so node_modules/ shipped is lean
npm prune --production --silent

ok "Local build complete. dist/ + node_modules/ ready to ship."

# ────────────────────────────────────────────────────────────────────
# 2. Snapshot remote for rollback
# ────────────────────────────────────────────────────────────────────

log "Snapshotting remote $REMOTE_DIR -> $REMOTE_BAK ..."
ssh "${SSH_OPTS[@]}" "$EC2_HOST" bash <<EOF
set -e
if [ -d $REMOTE_DIR ]; then
  sudo rm -rf $REMOTE_BAK
  sudo cp -a $REMOTE_DIR $REMOTE_BAK
  echo "[remote] snapshot saved at $REMOTE_BAK"
else
  echo "[remote] no existing $REMOTE_DIR; first deploy"
  sudo mkdir -p $REMOTE_DIR
  sudo chown ec2-user:ec2-user $REMOTE_DIR
fi
EOF

# ────────────────────────────────────────────────────────────────────
# 3. Rsync new build to remote
# ────────────────────────────────────────────────────────────────────

log "Rsyncing dist/, node_modules/, package.json ..."
# Use --delete on dist/ so removed files don't linger; node_modules/ uses
# --delete-after to avoid races with running process file handles.
rsync -avz --delete \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$LOCAL_WORKER_DIR/dist/" \
  "$EC2_HOST:$REMOTE_DIR/dist/"

rsync -avz --delete-after \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$LOCAL_WORKER_DIR/node_modules/" \
  "$EC2_HOST:$REMOTE_DIR/node_modules/"

rsync -avz \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
  "$LOCAL_WORKER_DIR/package.json" \
  "$LOCAL_WORKER_DIR/package-lock.json" \
  "$EC2_HOST:$REMOTE_DIR/"

ok "Rsync complete."

# ────────────────────────────────────────────────────────────────────
# 4. Restart service
# ────────────────────────────────────────────────────────────────────

log "Restarting $SERVICE_NAME.service ..."
ssh "${SSH_OPTS[@]}" "$EC2_HOST" "sudo systemctl restart $SERVICE_NAME.service && sleep 5 && sudo systemctl status $SERVICE_NAME.service --no-pager | head -15"

# ────────────────────────────────────────────────────────────────────
# 5. Verify (logs + /health)
# ────────────────────────────────────────────────────────────────────

ok "Tailing recent journalctl ..."
ssh "${SSH_OPTS[@]}" "$EC2_HOST" "sudo journalctl -u $SERVICE_NAME.service -n 80 --since '1 minute ago' --no-pager" 2>&1 | tail -50

ok "Checking /health endpoint ..."
HEALTH_BODY=$(ssh "${SSH_OPTS[@]}" "$EC2_HOST" "curl -s -m 5 $HEALTH_URL_LOCAL || echo '{}'")
echo "$HEALTH_BODY" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_BODY"

if echo "$HEALTH_BODY" | grep -q '"connected":true'; then
  ok "Worker is connected and streaming."
  if echo "$HEALTH_BODY" | grep -q '"GOLD"'; then
    ok "GOLD asset is in the per_asset map. Gold ticks will flow now."
  else
    warn "GOLD not in per_asset map. Either speed_assets.GOLD.enabled=FALSE or worker hasn't picked it up."
    warn "  To activate: UPDATE speed_assets SET enabled=TRUE WHERE id='GOLD'; then re-run this script."
  fi
else
  err "Worker reports disconnected or unhealthy. Check journalctl on EC2:"
  err "  ssh -i $SSH_KEY $EC2_HOST 'sudo journalctl -u $SERVICE_NAME.service -f'"
  err "Rollback available: bash scripts/deploy-paxg-oracle.sh --rollback"
  exit 1
fi

ok "Deploy complete."
echo "  Tail live: ssh -i $SSH_KEY $EC2_HOST 'sudo journalctl -u $SERVICE_NAME.service -f'"
echo "  Rollback:  bash scripts/deploy-paxg-oracle.sh --rollback"
