-- Chats sync by default: the person ignores the few they don't want, instead of ticking each one they do.
-- `synced = false` now means "ignored": none of its messages are stored and agents never see it.
alter table parley.chat alter column synced set default true;
-- Existing chats follow the new model: every chat syncs unless the person ignores it.
update parley.chat set synced = true, updated_at = now() where not synced;
