-- The gap between two sends on a number, chosen by its person: at least `gap_seconds`, up to twice that at random.
-- Null keeps the channel's default (WhatsApp 30–150s).
alter table parley.connection add column gap_seconds int check (gap_seconds between 0 and 3600);
