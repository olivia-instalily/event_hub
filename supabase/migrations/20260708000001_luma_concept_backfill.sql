-- One-time backfill: demote UNTOUCHED Luma events from 'Planning' back to 'Concept' (→ status
-- "future"). These were imported before the Luma sync started inserting new events as 'Concept'
-- (see cloud-functions/src/functions/luma-sync.ts and scripts/luma-sync.mjs), so they showed as
-- in-process despite nobody having worked on them.
--
-- Guard = the inverse of graduateFromConcept() in src/lib/db.ts: only demote if the event has NO
-- planning work of any kind. Auto-synced Luma guests (attendee_event rows) are NOT a "touch" — a
-- drawn event always carries its guest list — so they're intentionally not checked here. Idempotent
-- and safe: a touched event fails the WHERE clause and is left exactly where it is.
UPDATE event e
SET macro_stage = 'Concept'
WHERE e.luma_event_id IS NOT NULL
  AND e.macro_stage = 'Planning'
  AND e.status IS NULL                                            -- no manual status override
  AND e.headcount IS NULL                                         -- no essentials filled on-site
  AND e.event_budget_target IS NULL
  AND e.setup_complete IS NOT TRUE                                -- essentials flow not completed
  AND COALESCE(jsonb_array_length(e.setup_progress), 0) = 0
  AND COALESCE(jsonb_array_length(e.source_materials), 0) = 0     -- no source docs attached
  AND NOT EXISTS (SELECT 1 FROM deliverable d WHERE d.event_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM engagement g WHERE g.event_id = e.id);
