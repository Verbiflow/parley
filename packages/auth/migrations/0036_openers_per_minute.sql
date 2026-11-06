-- How many new contacts a number may open a conversation with per minute, chosen by its person. Null keeps the
-- channel's default (WhatsApp 2 a minute).
alter table parley.connection add column openers_per_minute int check (openers_per_minute between 1 and 60);
