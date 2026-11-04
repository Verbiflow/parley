-- Deleting a sent message for everyone. `unsend` makes the row a deletion of that message (the channel's id for it, one
-- the account sent); `body` is then empty. Paced like a reply: it's still something the account does.
alter table parley.outbound
  add column unsend text check (length(unsend) between 1 and 200),
  drop constraint outbound_body_check,
  add constraint outbound_body_check check (length(body) <= 8000 and (length(body) >= 1 or media is not null or react_to is not null or unsend is not null));
