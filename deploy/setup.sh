#!/usr/bin/env bash
# Written with AI assistance (Claude Code). See README "Use of AI tools".
# One-time setup for a fresh Ubuntu 24.04 droplet. Run as root:  bash setup.sh <site-host> "<deploy-public-key>"
set -euo pipefail
SITE_HOST="$1"
DEPLOY_PUBKEY="$2"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl gnupg ufw rsync unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

# Firewall: SSH + web only.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Node.js 22 LTS (for the small API proxy).
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (static files + automatic HTTPS).
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# A limited "deploy" user for GitHub Actions: it can update the site and restart the API, nothing else.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos '' deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart escape-velocity-api' > /etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy

install -d -o deploy -g deploy /var/www/escape-velocity /var/www/escape-velocity/releases /opt/escape-velocity-api
# Placeholder page until the first deploy lands.
if [ ! -e /var/www/escape-velocity/current ]; then
  install -d -o deploy -g deploy /var/www/escape-velocity/releases/initial
  echo '<!doctype html><title>Escape Velocity</title><p>Deploying soon...</p>' > /var/www/escape-velocity/releases/initial/index.html
  chown -R deploy:deploy /var/www/escape-velocity/releases/initial
  ln -sfn /var/www/escape-velocity/releases/initial /var/www/escape-velocity/current
  chown -h deploy:deploy /var/www/escape-velocity/current
fi

# Caddy config.
echo "SITE_HOST=$SITE_HOST" > /etc/default/caddy
install -m 644 /tmp/ev-deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/default/caddy\n' > /etc/systemd/system/caddy.service.d/env.conf

# API service.
install -m 644 /tmp/ev-deploy/escape-velocity-api.service /etc/systemd/system/escape-velocity-api.service
touch /etc/escape-velocity.env && chmod 600 /etc/escape-velocity.env

systemctl daemon-reload
systemctl enable caddy escape-velocity-api
systemctl restart caddy
echo "Setup done for https://$SITE_HOST"
