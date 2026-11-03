#!/bin/bash
# Point production at a WorkOS environment: prompts (hidden) for the client ID + API key, then updates
# Secrets Manager (parley/prod/app), the Worker's secrets, and restarts the sessions service so both sides agree.
#
#   deploy/set-workos.sh            (needs AWS profile flage-prod + wrangler login; Node 24 on PATH)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export AWS_PROFILE=${AWS_PROFILE:-flage-prod} AWS_REGION=us-east-1

read -r -p "WorkOS client ID (client_…): " CLIENT_ID
read -r -s -p "WorkOS API key (sk_live_…, hidden): " API_KEY; echo
[[ "$CLIENT_ID" =~ ^client_[A-Za-z0-9]+$ ]] || { echo "that doesn't look like a client ID" >&2; exit 1; }
[[ "$API_KEY" =~ ^sk_[A-Za-z0-9_]+$ ]] || { echo "that doesn't look like a WorkOS API key" >&2; exit 1; }
[[ "$API_KEY" == sk_live_* ]] || echo "note: this is not a live (Production) key"

# 1. Secrets Manager (source of truth; the EC2 reads it at service start)
aws secretsmanager get-secret-value --secret-id parley/prod/app --query SecretString --output text \
  | jq --arg c "$CLIENT_ID" --arg k "$API_KEY" '.WORKOS_CLIENT_ID=$c | .WORKOS_API_KEY=$k' \
  | aws secretsmanager put-secret-value --secret-id parley/prod/app --secret-string file:///dev/stdin --query VersionId --output text >/dev/null
echo "✓ Secrets Manager updated"

# 2. Worker secrets (takes effect immediately)
jq -n --arg c "$CLIENT_ID" --arg k "$API_KEY" '{WORKOS_CLIENT_ID:$c, WORKOS_API_KEY:$k}' \
  | (cd apps/api && npx wrangler secret bulk >/dev/null)
echo "✓ Worker secrets updated"

# 3. Restart the sessions service so it re-reads its env
INSTANCE_ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=parley-sessions Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
CMD=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --comment "workos rotate" \
  --parameters 'commands=["systemctl restart parley-sessions","sleep 3","curl -fsS http://127.0.0.1:8790/health"]' --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE_ID"
echo "✓ sessions service restarted"
echo "Done. Sign in at https://app.itsparley.com"
