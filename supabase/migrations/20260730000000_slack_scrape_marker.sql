-- Scrape-on-open: remember how far we've extracted a linked channel, so each open only processes
-- messages since the marker (incremental) and skips entirely when nothing's new. One channel per
-- event, so the marker lives on the event row.
alter table event add column if not exists slack_last_extracted_ts text;
