-- How each account last signed in, and the GitHub user linked to it. `github_id` is GitHub's numeric user ID, which
-- survives a renamed login. Both are refreshed at every sign-in; an account from before this migration has neither
-- until its next sign-in.
alter table identity.account
  add column signed_in_with text check (signed_in_with in ('github', 'google', 'local')),
  add column github_id text check (github_id ~ '^[0-9]{1,20}$');
