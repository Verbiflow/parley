-- One webhook per URL on a number, so an agent that retries create_webhook doesn't end up with two. The URL is sealed,
-- so it's compared by a keyed fingerprint (HMAC-SHA256 of the account and the whole URL, under a key derived from the
-- sign-in key): equal for the same URL, and useless for guessing one. Webhooks made before this get theirs from the
-- sessions service; any duplicates already there keep working without one.
alter table parley.webhook add column url_fingerprint text check (length(url_fingerprint) = 64);
create unique index webhook_url_once_idx on parley.webhook (connection_id, url_fingerprint) where url_fingerprint is not null;
