-- A webhook URL often carries the receiver's key (?token=…, Slack's /services/…/<secret>, a Discord token), so the
-- whole URL is sealed like the signing secret (under its own purpose) and `url` keeps only what's shown: the address
-- with its keys masked. Webhooks made before this keep their URL in `url` until the sessions service seals it.
alter table parley.webhook
  add column url_sealed_version uuid,
  add column url_sealed_key_id text,
  add column url_sealed_iv text,
  add column url_sealed text,
  add constraint webhook_url_sealed_whole check (
    (url_sealed_version is null) = (url_sealed is null)
    and (url_sealed is null) = (url_sealed_key_id is null)
    and (url_sealed is null) = (url_sealed_iv is null)
  );
create index webhook_url_plain_idx on parley.webhook (id) where url_sealed is null;
