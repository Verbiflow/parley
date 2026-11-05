-- Whether linking this number asks the phone for its whole history (as WhatsApp's desktop app does) or only the last
-- few weeks (as a browser does). On by default. Only matters when the number is linked or relinked.
alter table parley.connection add column full_history boolean not null default true;
