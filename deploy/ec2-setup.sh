#!/usr/bin/env bash
# One-time setup for an Amazon Linux 2023 EC2 instance. Run as user rakesh with sudo rights:
#   REPO_URL=https://github.com/<you>/scenex-ai.git API_DOMAIN=api.yourdomain.com bash ec2-setup.sh
set -euo pipefail

: "${REPO_URL:?Set REPO_URL to your git repository}"
: "${API_DOMAIN:?Set API_DOMAIN, e.g. api.yourdomain.com}"

APP_DIR="$HOME/scenex-ai"

echo "==> Packages"
sudo dnf install -y git nginx nodejs npm
node -v   # must be 18 or newer

echo "==> Code"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

echo "==> API dependencies"
cd "$APP_DIR/server"
npm ci --omit=dev

echo "==> systemd service"
sudo cp "$APP_DIR/deploy/scenex-api.service" /etc/systemd/system/scenex-api.service
sudo systemctl daemon-reload
sudo systemctl enable scenex-api

echo "==> nginx"
sed "s/api.yourdomain.com/${API_DOMAIN}/" "$APP_DIR/deploy/nginx-scenex-api.conf" | sudo tee /etc/nginx/conf.d/scenex-api.conf > /dev/null
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "==> Done. Next: create $APP_DIR/server/.env (see DEPLOY.md), then:"
echo "    sudo systemctl start scenex-api && sudo systemctl status scenex-api"
