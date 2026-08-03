-- "Upcoming meetings" on the event overview reads related calendar meetings. If a match is wrong, the
-- user detaches it — recorded here so it never re-appears for this event.
alter table event add column if not exists detached_meeting_ids jsonb not null default '[]';
