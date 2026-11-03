#!/bin/bash
# Renders /run/parley/env (tmpfs, root:parley 0640) from Secrets Manager at service start, so no secret ever sits on
# the EBS volume. Run by parley-sessions.service as ExecStartPre (as root, via the `+` prefix).
set -euo pipefail
REGION=us-east-1
DB_HOST=$(cat /etc/parley/db-host)

app=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id parley/prod/app --query SecretString --output text)
get() { jq -r --arg k "$1" '.[$k]' <<<"$app"; }

umask 027
mkdir -p /run/parley
chown root:parley /run/parley && chmod 750 /run/parley
tmp=$(mktemp /run/parley/env.XXXXXX)
{
  echo "PARLEY_ENV=production"
  echo "PARLEY_VERSION=$(cat /opt/parley/current/REVISION 2>/dev/null || echo unknown)"
  echo "PUBLIC_URL=https://app.itsparley.com"
  echo "HOST=127.0.0.1"
  echo "PORT=8790"
  echo "DATABASE_URL=postgres://parley_app:$(get DB_APP_PASSWORD)@${DB_HOST}:5432/parley?sslmode=verify-full&sslrootcert=/etc/parley/rds-ca.pem"
  echo "SIGN_IN_KEY=$(get SIGN_IN_KEY)"
  echo "CONNECTION_SIGNING_KEY=$(get CONNECTION_SIGNING_KEY)"
  echo "WORKOS_CLIENT_ID=$(get WORKOS_CLIENT_ID)"
  echo "WORKOS_API_KEY=$(get WORKOS_API_KEY)"
  echo "SESSIONS_SECRET=$(get SESSIONS_SECRET)"
} > "$tmp"
chown root:parley "$tmp" && chmod 640 "$tmp"   # mktemp creates 0600 regardless of umask
mv "$tmp" /run/parley/env
