-- Link an Assembly event to its Luma event so we can pull that event's guest list.
alter table event add column luma_event_id text;
create index on event (luma_event_id);
