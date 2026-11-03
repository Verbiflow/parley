-- A device's credential rotates. A refresh with a credential a day old is answered with a successor; the old one keeps
-- working until the successor is first used, so a device that didn't keep it loses nothing. Once the successor is used,
-- the old credential is retired, and a retired credential used again (after a minute's grace for a request already on
-- its way) means a copy of it is in someone else's hands: the device is signed out, and its event says why.

alter table identity.device
  add column next_credential_hash text unique,
  add column credential_issued_at timestamptz not null default now();

alter table identity.device drop constraint device_revoked_reason_check;
alter table identity.device add constraint device_revoked_reason_check check (revoked_reason in ('removed', 'signed-out', 'credential-reused'));

-- Each credential a device has rotated away from, by its SHA-256, kept while the device is.
create table identity.retired_credential (
  hash text primary key,
  device_id uuid not null references identity.device (id) on delete cascade,
  retired_at timestamptz not null default now()
);

alter table identity.device_event drop constraint device_event_kind_check;
alter table identity.device_event add constraint device_event_kind_check check (kind in ('enrolled', 'removed', 'signed-out', 'credential-reused'));
