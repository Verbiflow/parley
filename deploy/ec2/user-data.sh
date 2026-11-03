#!/bin/bash
# First-boot bootstrap for the Parley sessions EC2 (Amazon Linux 2023, arm64). Installs Node 24 + cloudflared,
# creates the unprivileged `parley` user, and installs the systemd units. The app itself arrives with
# deploy/deploy-sessions.sh (tarball from S3 via SSM). No SSH: manage the box with SSM Session Manager.
set -euxo pipefail

NODE_VERSION=24.11.1
REGION=us-east-1

dnf -y update
dnf -y install jq tar gzip postgresql16

# Node 24 (official arm64 build, checksum-verified).
cd /tmp
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
grep " node-v${NODE_VERSION}-linux-arm64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
mkdir -p /opt/node && tar -xJf "node-v${NODE_VERSION}-linux-arm64.tar.xz" -C /opt/node --strip-components=1
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/npm /usr/local/bin/npm
ln -sf /opt/node/bin/npx /usr/local/bin/npx

# cloudflared (Cloudflare's signed RPM).
curl -fsSL -o /tmp/cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-aarch64.rpm
dnf -y install /tmp/cloudflared.rpm

# RDS CA bundle, so Postgres connections verify the server certificate (sslmode=verify-full).
mkdir -p /etc/parley
curl -fsSL -o /etc/parley/rds-ca.pem "https://truststore.pki.rds.amazonaws.com/${REGION}/${REGION}-bundle.pem"
chmod 644 /etc/parley/rds-ca.pem

# A little swap so a memory spike degrades instead of OOM-killing the socket holder.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

useradd --system --home-dir /opt/parley --shell /sbin/nologin parley || true
mkdir -p /opt/parley/releases && chown -R parley:parley /opt/parley

# Units + env script are shipped in the release tarball too; these placeholders are replaced on first deploy.
systemctl daemon-reload
