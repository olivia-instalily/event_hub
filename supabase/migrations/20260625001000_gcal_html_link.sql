-- Store the Google Calendar event's web link so event cards can deep-link straight to it
-- (turning the calendar icon into a clickable shortcut once synced).
alter table event add column if not exists gcal_html_link text;
