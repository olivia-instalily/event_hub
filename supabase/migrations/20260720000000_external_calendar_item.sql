-- External conferences: lightweight "we're attending this" calendar instances that are NOT operated
-- events (no budget/deliverables/phases/workspace). Stored as minimal event rows flagged
-- is_external + lightweight, so attendee linkage (attendee_event) and the calendar reuse the same
-- machinery. Every non-external query excludes lightweight rows so no event affordances leak.
ALTER TABLE event
  ADD COLUMN IF NOT EXISTS is_external boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lightweight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS why         text,
  ADD COLUMN IF NOT EXISTS quarter     text,
  ADD COLUMN IF NOT EXISTS end_date    date,
  ADD COLUMN IF NOT EXISTS info_url    text;
