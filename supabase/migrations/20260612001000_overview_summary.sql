-- Cache the Overview status digest so Claude only regenerates it on an explicit
-- resync (not on every page view).
alter table event add column overview_summary text;

grant update (overview_summary) on event to anon, authenticated;
