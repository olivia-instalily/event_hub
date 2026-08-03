-- Scrape dedup: when a Slack fact is already on the event, don't add a duplicate — pin a link back to
-- the Slack moment on the existing record instead. Budget rows get a single source link; staff roles
-- get a {role: url} map on the event.
alter table budget_line add column if not exists slack_ref text;
alter table event      add column if not exists role_slack_refs jsonb not null default '{}';
