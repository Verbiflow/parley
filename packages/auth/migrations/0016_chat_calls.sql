-- WhatsApp calls count as activity in a chat, and the chat list says when the last one was and which way it went.
-- Only who and when: nothing about the call itself is kept.
alter table parley.chat
  add column last_call_at timestamptz,
  add column last_call_kind text check (last_call_kind in ('incoming', 'outgoing', 'missed'));
