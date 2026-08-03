-- Series-level "Form & structure" notes (push-wide concepts). Mirrors event.plan_items; series-wide
-- Slack captures "kept" at the series level land here (and manual add).
alter table event_series add column if not exists plan_items jsonb not null default '[]';
