-- Test accounts for proofs: an agent proving a flow end to end on staging signs in as an account the proof sign-in
-- made (`identity/proof.ts`), never as a person. Each one's subject is `proof:<uuid>` and its email is on the reserved
-- `.invalid` domain, so no provider's sign-in can ever reach it, nor its sign-in reach a person's account. `ends_at`
-- is when everything it signed in stops working; `ended_at`, when its proof ended it early. `ticket_hash` is the one
-- sign-in it may make next, spent once, within `ticket_expires_at`.
alter table identity.account drop constraint account_subject_check;
alter table identity.account add constraint account_subject_check check (subject ~ '^(workos|local|proof):.+$');
alter table identity.account drop constraint account_signed_in_with_check;
alter table identity.account add constraint account_signed_in_with_check check (signed_in_with in ('github', 'google', 'local', 'proof'));
alter table identity.browser_session drop constraint browser_session_method_check;
alter table identity.browser_session add constraint browser_session_method_check check (method in ('github', 'google', 'local', 'proof'));

create table identity.proof_account (
  user_id uuid primary key references identity.account (id) on delete cascade,
  made_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  ticket_hash text unique,
  ticket_expires_at timestamptz
);
create index proof_account_ends_idx on identity.proof_account (ends_at);
