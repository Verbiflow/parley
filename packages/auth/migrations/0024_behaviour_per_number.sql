-- Read receipts and typing are chosen per number (connection), not per Parley account: one number can send blue
-- ticks while another stays quiet. Both on unless turned off. The account-wide table they replace never held a row.
alter table parley.connection
  add column read_receipts boolean not null default true,
  add column typing boolean not null default true;
drop table parley.account_settings;
