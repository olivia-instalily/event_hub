-- "Plan" list on the event: things planned to happen (format, venue, timing, decided elements) that
-- don't warrant a deliverable. Confirmed Slack 'plan' captures land here; also manually editable.
alter table event add column if not exists plan_items jsonb not null default '[]';
