-- Every browser signed in to Parley's pages, made visible: the app lists them, each with how and where it signed in and
-- when and where it was last used, and ends one or all. A browser that signs in again replaces its own session rather
-- than leaving the old one behind.

-- `id` names a session to the app; the token's hash never leaves the database. Places are a coarse geo-IP read, never
-- the address. `user_agent` is kept as sent, bounded, to name the browser.
alter table identity.browser_session
  add column id uuid not null default gen_random_uuid(),
  add column method text check (method in ('github', 'google', 'local')),
  add column user_agent text check (length(user_agent) <= 400),
  add column signed_in_city text check (length(signed_in_city) <= 100),
  add column signed_in_region text check (length(signed_in_region) <= 100),
  add column signed_in_country text check (length(signed_in_country) = 2),
  add column last_seen_at timestamptz not null default now(),
  add column seen_city text check (length(seen_city) <= 100),
  add column seen_region text check (length(seen_region) <= 100),
  add column seen_country text check (length(seen_country) = 2);

alter table identity.browser_session add constraint browser_session_id_key unique (id);
create index browser_session_user_idx on identity.browser_session (user_id, last_seen_at desc);
