-- Track the Google Calendar copy of an event per calendar (we write to two calendars now: the primary
-- calendar@instalily.ai and the Instalily Events Coordination calendar), plus a pending match awaiting
-- user confirmation. See docs/superpowers/specs/2026-07-22-gcal-auto-sync-design.md.
ALTER TABLE event ADD COLUMN IF NOT EXISTS gcal_event_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE event ADD COLUMN IF NOT EXISTS gcal_match_pending jsonb;  -- nullable: candidate matches awaiting a decision
GRANT UPDATE (gcal_event_ids, gcal_match_pending) ON event TO anon, authenticated;
