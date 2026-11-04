-- Counting a chat's new reactions (on every tool call now): a range from the chat's marker, not every reaction it has.
create index reaction_seq_idx on parley.reaction (connection_id, chat_id, seq);
