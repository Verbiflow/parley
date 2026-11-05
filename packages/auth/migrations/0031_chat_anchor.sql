-- A bookmark in a chat Parley keeps no messages from (an ignored one): its newest message's id, sender, whether it was
-- the account's own, and when it was sent, never its text. History is fetched from the phone by counting back from a
-- message, so this lets a chat turned back on load its history before a new message arrives.
alter table parley.chat add column anchor jsonb;
