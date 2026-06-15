-- Manual framing of the event cover photo (CSS object-position, e.g. '50% 30%').
alter table event add column cover_position text;
grant update (cover_position) on event to anon, authenticated;
