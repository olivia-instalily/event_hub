-- Reshape slack_capture for the consolidated capture brief: homes (plan/person/open/budget) instead
-- of the v1 type set, and summary/detail/source_quote instead of a free-form payload. Table has 0
-- rows in prod, so this is a clean reshape (no data migration).
alter table slack_capture drop constraint if exists slack_capture_type_check;
alter table slack_capture rename column type to home;
alter table slack_capture add constraint slack_capture_home_check check (home in ('plan','person','open','budget'));
alter table slack_capture add column if not exists summary text;
alter table slack_capture add column if not exists detail text;
alter table slack_capture add column if not exists source_quote text;
alter table slack_capture drop column if exists payload;
alter table slack_capture drop column if exists confidence;
