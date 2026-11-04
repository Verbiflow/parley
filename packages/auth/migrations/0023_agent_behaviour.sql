-- How agents behave in the account holder's chats, across all their connected accounts. Both on unless they turn
-- them off: reading a chat sends read receipts (blue ticks, if their own WhatsApp setting allows), and a message
-- shows "typing…" before it goes. An agent can skip either per call; with one off here, no agent can turn it on.
-- No row means the defaults.
create table parley.account_settings (
  account_id uuid primary key references identity.account (id) on delete cascade,
  read_receipts boolean not null default true,
  typing boolean not null default true,
  updated_at timestamptz not null default now()
);
