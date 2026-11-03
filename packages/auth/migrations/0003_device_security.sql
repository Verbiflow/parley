-- Device enrollment, made answerable: where and when each device joined, where each device code was asked from, and
-- every device's events kept, so a person can see how a device came to be signed in as them, and an approval page can
-- say where a code came from before anyone connects it.

-- Places are a coarse read of the request's geo-IP (a city, a region, a country), when known. The address itself is
-- never kept.
alter table identity.device
  add column enrolled_city text check (length(enrolled_city) <= 100),
  add column enrolled_region text check (length(enrolled_region) <= 100),
  add column enrolled_country text check (length(enrolled_country) = 2);

alter table identity.device_code
  add column requested_city text check (length(requested_city) <= 100),
  add column requested_region text check (length(requested_region) <= 100),
  add column requested_country text check (length(requested_country) = 2);

-- A device code never connects a desktop (desktops sign in through the browser): what a code asks to connect can't
-- pass itself off as a person's own computer on the approval page.
alter table identity.device_code add constraint device_code_not_desktop check (device_kind <> 'desktop') not valid;

-- What happened to each device, newest first per account: enrolled (by the browser or a device code), removed by
-- another device, signed out by itself. `by_device` is the device that removed it.
create table identity.device_event (
  id bigint generated always as identity primary key,
  user_id uuid not null references identity.account (id) on delete cascade,
  device_id uuid not null references identity.device (id) on delete cascade,
  kind text not null check (kind in ('enrolled', 'removed', 'signed-out')),
  method text check (method in ('browser', 'device-code')),
  by_device uuid references identity.device (id) on delete set null,
  city text check (length(city) <= 100),
  region text check (length(region) <= 100),
  country text check (length(country) = 2),
  at timestamptz not null default now()
);
create index device_event_account_idx on identity.device_event (user_id, at desc);
