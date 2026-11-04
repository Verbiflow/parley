-- One daily limit per connection: every send (replies, new conversations, reactions) counts toward it. The person
-- sets it; it replaces the per-kind warmup ramp. `warmup` stays for now but is no longer read.
alter table parley.connection
  add column daily_limit int not null default 100 check (daily_limit between 1 and 1000);
