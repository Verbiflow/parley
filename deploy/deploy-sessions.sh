#!/bin/bash
# Deploy the sessions service to the EC2 box: ship the committed HEAD as a tarball via S3, then (over SSM — no SSH)
# install deps, run migrations, switch the `current` symlink, restart, and health-check. Keeps the last 5 releases.
#
#   AWS_PROFILE=flage-prod deploy/deploy-sessions.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REGION=us-east-1
BUCKET=parley-prod-artifacts-535002857030
INSTANCE_ID=$(aws ec2 describe-instances --region $REGION --filters Name=tag:Name,Values=parley-sessions Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
[[ "$INSTANCE_ID" == i-* ]] || { echo "no running parley-sessions instance" >&2; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then echo "commit your changes first (deploys ship HEAD)" >&2; exit 1; fi
SHA=$(git rev-parse --short=12 HEAD)
TARBALL=$(mktemp -t parley-release).tgz
git archive --format=tar.gz -o "$TARBALL" HEAD
aws s3 cp --region $REGION --only-show-errors "$TARBALL" "s3://$BUCKET/releases/$SHA.tgz"
rm -f "$TARBALL"

read -r -d '' SCRIPT <<EOF || true
set -euo pipefail
R=/opt/parley/releases/$SHA
rm -rf "\$R" && mkdir -p "\$R"
aws s3 cp --region $REGION --only-show-errors s3://$BUCKET/releases/$SHA.tgz /tmp/release.tgz
tar -xzf /tmp/release.tgz -C "\$R" && rm -f /tmp/release.tgz
echo $SHA > "\$R/REVISION"
cd "\$R" && HOME=/root npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod 750 deploy/ec2/*.sh
chown -R parley:parley "\$R"
id cloudflared >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin cloudflared
install -m 644 deploy/ec2/parley-sessions.service /etc/systemd/system/parley-sessions.service
install -m 644 deploy/ec2/cloudflared.service /etc/systemd/system/cloudflared.service
ln -sfn "\$R" /opt/parley/current
systemctl daemon-reload
/opt/parley/current/deploy/ec2/parley-env.sh
cd /opt/parley/current && sudo -u parley /usr/local/bin/node --env-file=/run/parley/env scripts/migrate.ts
systemctl enable --now cloudflared
systemctl enable parley-sessions && systemctl restart parley-sessions
for i in \$(seq 1 30); do curl -fsS http://127.0.0.1:8790/health && break; sleep 1; done
curl -fsS http://127.0.0.1:8790/health >/dev/null
ls -1dt /opt/parley/releases/* | tail -n +6 | xargs -r rm -rf
journalctl -u parley-sessions -n 5 --no-pager
EOF

CMD_ID=$(aws ssm send-command --region $REGION --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "parley-sessions deploy $SHA" --timeout-seconds 900 \
  --parameters "$(jq -n --arg s "$SCRIPT" '{commands: [$s], executionTimeout: ["900"]}')" \
  --query Command.CommandId --output text)
echo "deploying $SHA to $INSTANCE_ID (ssm $CMD_ID)…"
aws ssm wait command-executed --region $REGION --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" || true
aws ssm get-command-invocation --region $REGION --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
