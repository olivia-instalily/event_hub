-- Per-guest status on the attendee↔event link, sourced from Luma on sync.
alter table attendee_event add column registration_status text;  -- approved / pending / waitlist / declined / invited
alter table attendee_event add column checked_in boolean default false;

-- Backfill the named TTW attendees on the CURRENT db (no-op on fresh reset; seed sets these).
update attendee_event set registration_status = 'approved', checked_in = true
  where attendee_id in ('att-erchit', 'att-naveen', 'att-amit');
