-- Connect each learning (reflection) to the EVENT it came from, so carried learnings can link
-- back to a real event instead of just naming the series.
alter table reflection add column if not exists event_id text references event(id) on delete set null;

-- Backfill provenance generically: attribute a series' learnings to its most recent past event
-- (the one that most likely produced the debrief), where we don't know better.
update reflection r
set event_id = (
  select e.id from event e
  where e.series_id = r.series_id and e.event_date is not null
  order by e.event_date desc
  limit 1
)
where r.event_id is null and r.series_id is not null;

-- Known case: the TTW 2026 learnings (presentation/AV check, overflow, name tags, camera device)
-- came from the fireside, "Building AI for Enterprise".
update reflection set event_id = 'evt-ttw-fireside'
where series_id = 'ser-ttw-2026';
