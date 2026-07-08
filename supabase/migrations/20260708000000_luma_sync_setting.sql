-- Incremental Luma sync bookkeeping. Holds the timestamp of the last successful background sync
-- (see cloud-functions/src/functions/luma-sync.ts). null = never synced. Used as a throttle so
-- page-load syncs don't hammer Luma's 300/min rate limit — Luma has no "changed since" filter,
-- so this is a time gate, not a cursor pushed to the API.
INSERT INTO app_setting (key, value)
VALUES ('luma_last_synced', null)
ON CONFLICT (key) DO NOTHING;
