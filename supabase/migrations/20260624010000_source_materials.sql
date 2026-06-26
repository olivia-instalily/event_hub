-- The original files dropped to create an event/template, kept for reference and shown at
-- the top of the event. [{ name, url, type }] — uploaded to the attachments bucket.
alter table event add column if not exists source_materials jsonb default '[]'::jsonb;
