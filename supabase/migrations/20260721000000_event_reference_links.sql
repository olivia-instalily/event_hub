-- Reference links: open-only resources (Google Docs / sheets / folders) attached to an event, for
-- teammates to open. Never processed/ingested — distinct from source_materials. jsonb array of
-- { id, label, url, kind }.
ALTER TABLE event ADD COLUMN IF NOT EXISTS reference_links jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (reference_links) ON event TO anon, authenticated;
