# Deploying Parley (production)

```
                 Internet
                    │  https://app.itsparley.com
                    ▼
        ┌──────────────────────────┐
        │ Cloudflare Worker        │  dashboard · WorkOS sign-in · OAuth · /mcp      apps/api/src/worker.ts
        │ parley-app               │
        └──────┬────────────┬──────┘
   Hyperdrive  │            │  Workers VPC binding SESSIONS (+ SESSIONS_SECRET bearer)
   (VPC svc    │            │
   parley-db)  ▼            ▼
        ┌─────────── Cloudflare Tunnel parley-prod (outbound-only from EC2) ───────────┐
        │                                                                             │
        │  AWS flage-prod · us-east-1 · default VPC                                   │
        │  ┌─────────────────────────────┐        ┌──────────────────────────────┐    │
        │  │ EC2 parley-sessions t4g.small│ 5432  │ RDS parley-prod              │    │
        │  │ cloudflared + Node 24        │──────▶│ Postgres 16, db.t4g.small    │    │
        │  │ sessions-server.ts :8790     │  TLS  │ private, encrypted, PITR 14d │    │
        │  │ (Baileys sockets)            │ verify│ gp3 20→200 GB autoscaling    │    │
        │  └─────────────────────────────┘  full  └──────────────────────────────┘    │
        └─────────────────────────────────────────────────────────────────────────────┘
```

Only `app.itsparley.com` is public. The EC2 has **no inbound rules** (reached only through the tunnel it dials out;
admin via SSM Session Manager — no SSH key). The RDS is **not publicly accessible** and accepts 5432 only from the
EC2's security group. Secrets live in AWS Secrets Manager (`parley/prod/app`, `parley/prod/tunnel-token`, and the
RDS-managed master secret) and Cloudflare Worker secrets — never in the repo or on disk.

## Deploy

```sh
# Sessions service (EC2) — ships committed HEAD, runs migrations, restarts, health-checks
AWS_PROFILE=flage-prod deploy/deploy-sessions.sh

# Edge app (Cloudflare Worker)
cd apps/api && npx wrangler deploy
```

Deploy the sessions service first when a change touches both (the Worker calls the RPC; migrations run there).

## Operate

```sh
# Shell on the box (no SSH)
aws ssm start-session --profile flage-prod --region us-east-1 --target $(aws ec2 describe-instances --profile flage-prod --region us-east-1 \
  --filters Name=tag:Name,Values=parley-sessions Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
sudo journalctl -u parley-sessions -f      # sessions logs
sudo journalctl -u cloudflared -f          # tunnel logs

# Worker logs
cd apps/api && npx wrangler tail
```

## Resources

| What | Name |
|---|---|
| Worker | `parley-app` (custom domain `app.itsparley.com`) |
| Hyperdrive | `parley-prod` → VPC service `parley-db` |
| VPC service (HTTP) | `parley-sessions` → tunnel → `127.0.0.1:8790` |
| Tunnel | `parley-prod` |
| EC2 | `parley-sessions` (SG `parley-sessions`, role `parley-sessions-ec2`) |
| RDS | `parley-prod` (SG `parley-db`, params `parley-pg16`, subnets `parley-prod`) |
| Secrets | `parley/prod/app`, `parley/prod/tunnel-token`, RDS master (`rds!db-…`) |
| Artifacts | `s3://parley-prod-artifacts-535002857030/releases/` |

The Worker's secrets (`wrangler secret put`) are copies of the same values in `parley/prod/app`: `SIGN_IN_KEY`,
`CONNECTION_SIGNING_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `SESSIONS_SECRET`. Rotate in both places.

## Scaling notes

- More WhatsApp accounts than one box holds: add EC2s with `REDIS_URL` set (the Redis coordinator already routes
  commands to whichever worker owns a connection).
- DB: storage autoscales to 200 GB; bump `db.t4g.small` → `medium` when RAM-bound; enable Multi-AZ for failover.
