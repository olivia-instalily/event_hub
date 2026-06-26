-- Phases + deliverable offset ranges + planning lead-time (drop-ingest timeline).
-- Deliverable offsets become a range (start + optional end); keep due_offset_days for compat.
alter table deliverable add column if not exists offset_start integer;
alter table deliverable add column if not exists offset_end   integer;

-- Lightweight phases on the event: [{ name, order }] (named by the brief's sections), and the
-- planning window the timeline renders against.
alter table event add column if not exists phases             jsonb default '[]'::jsonb;
alter table event add column if not exists planning_lead_time text;
