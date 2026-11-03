#!/bin/bash
# One-time (idempotent): create the least-privilege `parley_app` role on the RDS using the RDS-managed master secret.
# parley_app can connect to and create schemas in the `parley` database only — no superuser, no other databases.
# The master password is never written to disk; it lives in Secrets Manager and RDS rotates it.
set -euo pipefail
REGION=us-east-1
DB_HOST=$(cat /etc/parley/db-host)
MASTER_SECRET_ARN=$(cat /etc/parley/db-master-secret-arn)

master=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$MASTER_SECRET_ARN" --query SecretString --output text)
app_pw=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id parley/prod/app --query SecretString --output text | jq -r .DB_APP_PASSWORD)

export PGPASSWORD=$(jq -r .password <<<"$master")
export PGSSLMODE=verify-full PGSSLROOTCERT=/etc/parley/rds-ca.pem
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -U "$(jq -r .username <<<"$master")" -d parley -v app_pw="$app_pw" <<'SQL'
select format('create role parley_app login password %L', :'app_pw') where not exists (select from pg_roles where rolname = 'parley_app') \gexec
select format('alter role parley_app password %L', :'app_pw') \gexec
alter role parley_app connection limit 50;
revoke all on database parley from public;
grant connect, create, temporary on database parley to parley_app;
grant usage, create on schema public to parley_app;
SQL
echo "parley_app ready"
