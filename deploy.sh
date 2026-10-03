#!/usr/bin/env bash
# deploy.sh – Build and deploy opencloud-calendar to the OpenCloud server
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# The deploy user's key is bound to a forced command on the server
# (deploy/server/agenda-deploy): it uploads into the app directory and
# restarts the containers, nothing else — see deploy/server/SETUP.md.
REMOTE_USER="deploy"
REMOTE_HOST="cloud.linux-nerds.org"
APP_NAME="opencloud-agenda"
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_OPTS="-i /home/frank/.ssh-jail/opencloud/hetzner_opencloud -o IdentitiesOnly=yes -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes"
DIST_DIR="$SCRIPT_DIR/dist"

if [ "${container:-}" = "firejail" ]; then
  echo "ERROR: Dieses Script läuft in einer Firejail-Sandbox (Claude Code)." >&2
  echo "       Bitte im eigenen Terminal ausführen: bash deploy.sh" >&2
  exit 1
fi

echo "==> Building $APP_NAME …"
cd "$SCRIPT_DIR"
CI=true pnpm install
pnpm build

echo "==> Uploading dist/ to ${REMOTE_HOST} …"
rsync -av --delete -e "ssh $SSH_OPTS" "$DIST_DIR/" "${REMOTE_USER}@${REMOTE_HOST}:./"

echo "==> Restarting OpenCloud container …"
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" restart

echo ""
echo "Done. App available at: https://${REMOTE_HOST}/apps/${APP_NAME}/"
