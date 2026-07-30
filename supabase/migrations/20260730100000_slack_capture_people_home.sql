-- Scrape-everything: people met/discussed in a channel who have no clear match in the People list are
-- surfaced as 'people' captures on the event's People page ("no match — add anyway / dismiss"). Widen
-- the home check to allow them. (Matched people are tagged directly via person_tag, not stored here.)
alter table slack_capture drop constraint if exists slack_capture_home_check;
alter table slack_capture add constraint slack_capture_home_check
  check (home in ('plan','person','vendor','open','budget','people'));
