-- Allow removing a person (and their event link) from the dashboard.
grant delete on attendee_event to anon, authenticated;
grant delete on attendee to anon, authenticated;
