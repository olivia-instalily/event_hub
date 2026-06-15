-- Per-event, editable tag (replaces using the series type as the card pill).
alter table event add column tag text;

-- Backfill the two TTW sub-events (no-op on a fresh reset where seed runs after migrations).
update event set tag = 'Fireside'   where id = 'evt-ttw-fireside';
update event set tag = 'Happy Hour' where id = 'evt-ttw-happyhour';

-- Allow the dashboard (anon) to edit just this column. Low-stakes field, no secret.
grant update (tag) on event to anon, authenticated;
