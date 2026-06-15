-- External id (e.g. Gmail message id) so re-running a sync doesn't duplicate feed
-- entries. Nullable; only integration-sourced rows set it.
alter table event_update add column external_id text;
create index on event_update (event_id, external_id);
