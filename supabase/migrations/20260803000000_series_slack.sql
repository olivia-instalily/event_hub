-- Series-level Slack: one channel covers a collective push of grouped events. Marker + channel live on
-- the series; facts route to member events (confident) or stay series-level (push-wide / unassigned).
alter table event_series add column if not exists slack_channel text;
alter table event_series add column if not exists slack_last_extracted_ts text;
create index if not exists event_series_slack_channel_idx on event_series(slack_channel);

-- Series-level staffing store (push-wide crew). budget.series_id already exists for series-level costs.
alter table event_series add column if not exists staff_roles      jsonb not null default '[]';
alter table event_series add column if not exists role_assignments jsonb not null default '{}';
alter table event_series add column if not exists role_slack_refs  jsonb not null default '{}';

-- A capture can belong to a series (series-wide / unassigned, awaiting routing) as well as an event.
alter table slack_capture add column if not exists series_id text references event_series(id) on delete cascade;
alter table slack_capture alter column event_id drop not null;
alter table slack_capture drop constraint if exists slack_capture_event_or_series;
alter table slack_capture add constraint slack_capture_event_or_series check (event_id is not null or series_id is not null);
create index if not exists slack_capture_series_idx on slack_capture(series_id);
