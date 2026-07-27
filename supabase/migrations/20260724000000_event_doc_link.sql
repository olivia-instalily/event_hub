-- Single Drive/Doc link shown prominently in the event header (mirrors the series folderUrl).
-- Distinct from reference_links, which is a list shown in the Resources area.
ALTER TABLE event ADD COLUMN IF NOT EXISTS doc_link text;
GRANT UPDATE (doc_link) ON event TO anon, authenticated;
