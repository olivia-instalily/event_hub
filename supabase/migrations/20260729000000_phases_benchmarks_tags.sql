-- Three-phase model: benchmarks (optional, per-event) + cross-cutting deliverable tags.
ALTER TABLE event ADD COLUMN IF NOT EXISTS benchmarks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE deliverable ADD COLUMN IF NOT EXISTS benchmark_id text;
ALTER TABLE deliverable ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT UPDATE (benchmarks) ON event TO anon, authenticated;
GRANT UPDATE (benchmark_id, tags) ON deliverable TO anon, authenticated;

-- Backfill: collapse every existing deliverable's phase to planning/day-of/post by timing.
UPDATE deliverable d SET phase = CASE
  WHEN d.offset_start IS NOT NULL AND d.offset_start < 0 THEN 'planning'
  WHEN d.offset_start IS NOT NULL AND d.offset_start = 0 THEN 'day-of'
  WHEN d.offset_start IS NOT NULL AND d.offset_start > 0 THEN 'post'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date < e.event_date THEN 'planning'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date = e.event_date THEN 'day-of'
  WHEN e.event_date IS NOT NULL AND d.resolved_due_date IS NOT NULL AND d.resolved_due_date > e.event_date THEN 'post'
  ELSE 'planning'
END
FROM event e
WHERE d.event_id = e.id AND e.is_template = false;
