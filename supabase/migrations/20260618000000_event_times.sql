-- Start/end time on every event, alongside the existing event_date. Stored as local
-- "HH:MM" strings (the date carries the day; these carry the clock time).
alter table event add column if not exists start_time text;
alter table event add column if not exists end_time   text;
