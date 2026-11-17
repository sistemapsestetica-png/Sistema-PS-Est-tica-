#!/usr/bin/env bash
set -euo pipefail
test -f /tmp/ps-monitor.tar.gz
test -f /tmp/ps-monitor.env
test -f /tmp/ps-blackfriday-monitor.service

sudo systemctl stop ps-blackfriday-monitor.service 2>/dev/null || true
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/ps-blackfriday-monitor
sudo find /opt/ps-blackfriday-monitor -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo tar -xzf /tmp/ps-monitor.tar.gz -C /opt/ps-blackfriday-monitor
sudo chown -R ubuntu:ubuntu /opt/ps-blackfriday-monitor
sudo install -d -o ubuntu -g ubuntu -m 700 /var/lib/ps-blackfriday-monitor
sudo install -o root -g root -m 600 /tmp/ps-monitor.env /etc/ps-blackfriday-monitor.env
sudo install -o root -g root -m 644 /tmp/ps-blackfriday-monitor.service /etc/systemd/system/ps-blackfriday-monitor.service
sudo -u ubuntu /usr/local/bin/npm ci --omit=dev --prefix /opt/ps-blackfriday-monitor
sudo systemctl daemon-reload
sudo systemctl enable --now ps-blackfriday-monitor.service
sleep 3
sudo systemctl --no-pager --full status ps-blackfriday-monitor.service | sed -n '1,12p'
