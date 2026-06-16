-- Record the past event a planning event was "started from" (the manually-linked
-- template in the create flow). Carried lessons draw from what this event is
-- connected to immediately, before any tag-based comparability kicks in.
alter table event add column if not exists modeled_on_event_id text references event(id) on delete set null;
-- (insert is already table-level granted on event; no extra grant needed.)
