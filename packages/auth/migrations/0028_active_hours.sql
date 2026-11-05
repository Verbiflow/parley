-- Active hours are a per-number choice, off by default: a number sends at any hour unless its person turns them on,
-- and then it keeps to its channel's local window (WhatsApp 8:00–21:00 in the connection's time zone).
alter table parley.connection add column active_hours boolean not null default false;
