#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/deleondiego9/deal-scout.git"
DIR="/opt/deal-scout"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root on the Droplet."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates openssl

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if [ ! -d "$DIR/.git" ]; then
  rm -rf "$DIR"
  git clone "$REPO" "$DIR"
else
  git -C "$DIR" fetch origin
  git -C "$DIR" reset --hard origin/main
fi

cd "$DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  key="$(openssl rand -hex 16)"
  sed -i "s/^API_KEY=.*/API_KEY=$key/" .env
  echo "Wrote API_KEY to $DIR/.env"
fi

npm ci --omit=dev
install -m 644 deploy/deal-scout.service /etc/systemd/system/deal-scout.service
systemctl daemon-reload
systemctl enable --now deal-scout
sleep 1
systemctl --no-pager --full status deal-scout || true

if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo
  echo "Deal Scout is running on this Droplet at port 3000."
  echo "Next: point a domain at this server and put nginx + HTTPS in front."
else
  echo
  echo "Service installed but health check failed. Run: journalctl -u deal-scout -n 80 --no-pager"
  exit 1
fi
