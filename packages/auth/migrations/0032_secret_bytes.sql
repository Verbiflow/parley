-- A WhatsApp connection's saved state (creds plus every encryption and app-state key) outgrew 256 KiB after a couple of
-- days linked: saves were refused, and each restart reloaded older keys. Allow up to 4 MiB.
alter table secret.record drop constraint record_bytes_check;
alter table secret.record add constraint record_bytes_check check (bytes between 0 and 4194304);
