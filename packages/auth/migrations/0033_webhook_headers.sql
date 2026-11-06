-- Headers a webhook sends of its own on every request, for receivers that want to know who's calling (an
-- Authorization, an X-Api-Key). The values are credentials, so they're sealed like the signing secret (under their
-- own purpose); only the names and a hint of each value (its last four characters, when it's long) are kept in the
-- clear, to show back.
alter table parley.webhook
  add column header_hints jsonb not null default '[]' check (jsonb_typeof(header_hints) = 'array' and jsonb_array_length(header_hints) <= 10),
  add column headers_sealed_version uuid,
  add column headers_sealed_key_id text,
  add column headers_sealed_iv text,
  add column headers_sealed text,
  add constraint webhook_headers_sealed_whole check (
    (headers_sealed_version is null) = (headers_sealed is null)
    and (headers_sealed is null) = (headers_sealed_key_id is null)
    and (headers_sealed is null) = (headers_sealed_iv is null)
  );
