#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends ca-certificates curl xz-utils ufw

if ! sudo swapon --show=NAME --noheadings | grep -q .; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

node_archive="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/ {print $2; exit}')"
node_hash="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/ {print $1; exit}')"
test -n "$node_archive" && test -n "$node_hash"
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$node_archive"
printf '%s  %s\n' "$node_hash" "$node_archive" | sha256sum --check --status
sudo mkdir -p /opt/node22
sudo tar -xJf "$node_archive" --strip-components=1 -C /opt/node22
rm -f "$node_archive"
sudo ln -sfn /opt/node22/bin/node /usr/local/bin/node
sudo ln -sfn /opt/node22/bin/npm /usr/local/bin/npm
sudo ln -sfn /opt/node22/bin/npx /usr/local/bin/npx

sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow OpenSSH >/dev/null
sudo ufw --force enable >/dev/null

sudo install -d -o ubuntu -g ubuntu -m 700 /opt/ps-blackfriday-monitor
printf 'NODE=%s\nNPM=%s\nSWAP=%s\nFIREWALL=%s\n' "$(node --version)" "$(npm --version)" "$(free -m | awk '/Swap/{print $2"MB"}')" "$(sudo ufw status | head -n1)"
