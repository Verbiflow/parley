-- Search (the `search` tool): case-insensitive substring matches on message text and chat names, in any language
-- (trigrams, not a stemmed full-text index, so names, numbers, slang and mixed languages all match).
create extension if not exists pg_trgm;
create index message_body_trgm_idx on parley.message using gin (body gin_trgm_ops);
create index chat_name_trgm_idx on parley.chat using gin (name gin_trgm_ops);
