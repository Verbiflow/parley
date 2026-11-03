-- The account's secret store: one record shape for every kind of secret, each value sealed (AES-256-GCM, secrets/seal.ts)
-- before it reaches here, so the value is opaque to everything but the seal that made it. Parley keeps each channel
-- connection's session credentials here.
create schema if not exists secret;

-- One secret: whose, what kind, what it's for (for a channel connection, purpose is the channel and name is the
-- connection id) and its sealed value. `scheme` names how it was sealed, `key_id` with which key, and `version` is new
-- on every write and bound into the seal, so a sealed value moved to another record, or an older one put back, won't
-- open.
create table secret.record (
  user_id uuid not null references identity.account (id) on delete cascade,
  kind text not null check (kind in ('saved-key', 'channel-creds')),
  purpose text not null check (length(purpose) between 1 and 300),
  name text not null check (length(name) between 1 and 300),
  version uuid not null,
  scheme text not null check (scheme in ('server.v1')),
  key_id text not null check (length(key_id) between 1 and 100),
  iv text not null check (length(iv) between 1 and 100),
  sealed text not null,
  bytes integer not null check (bytes between 0 and 262144),
  device_id uuid,
  expires_at timestamptz,
  saved_at timestamptz not null default now(),
  primary key (user_id, kind, purpose, name)
);
