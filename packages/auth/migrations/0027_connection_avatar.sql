-- The linked number's own profile picture, shown on its card: WhatsApp's small thumbnail as a data: URL (WhatsApp's
-- picture links expire, so we keep the bytes). Refreshed each time the connection opens; null when it has none.
alter table parley.connection add column avatar text check (length(avatar) <= 200000);
