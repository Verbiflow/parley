-- The agent can ask for a message to go out the way a person sends it: the chat shows "typing…" (or "recording…"
-- before a voice note) for about as long as it takes, then the message. Per message; off unless asked.
alter table parley.outbound
  add column typing boolean not null default false;
