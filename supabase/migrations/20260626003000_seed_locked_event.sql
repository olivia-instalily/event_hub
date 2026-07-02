-- Seed: a past, fully-filled, SETTLED (locked) event so the read-only rundown mode has
-- something to show. A recruiting fireside that happened ~3 weeks ago. Idempotent.

insert into event (
  id, name, format, location, event_date, start_time, end_time,
  tags, macro_stage, is_template, setup_complete, rsvp, capacity, checked_in, headcount,
  phases, staff_roles, reflections, role_assignments, verdict, debrief_notes,
  settle_state, settled_at
) values (
  'evt-seed-locked', 'AI Builders Fireside — NYC', 'Fireside', 'New York', date '2026-06-05', '18:00', '20:00',
  array['Brand & community event']::text[], 'Wrapped', false, true, 80, 60, 44, 80,
  '[{"name":"Plan it","order":0},{"name":"Promote","order":1},{"name":"Event day","order":2},{"name":"Wrap","order":3}]'::jsonb,
  '["Event lead","Photographer","Speaker host"]'::jsonb,
  '["Start speaker outreach 3 weeks earlier","Cap RSVPs at ~1.5x capacity — show rate ran ~55%","Coffee ran out — order for 70% of checked-in next time"]'::jsonb,
  '{"Event lead":"Olivia","Photographer":"Maya (freelance)","Speaker host":"Devan"}'::jsonb,
  'Strong turnout and two standout candidates surfaced. Worth repeating next quarter — but start outreach earlier and over-order coffee.',
  'Debrief — AI Builders Fireside (2026-06-08)\n\nWhat worked: speaker lineup landed, room felt full, good energy in the Q&A.\nWhat to change: invites went out late; coffee ran out ~45 min in.\nPeople: Priya Shah (ML eng, actively looking — strong), Marcus Lee (infra, curious), Dana Wu (founder, possible partner).\nFollow-ups: send thank-you + deck, intro Priya to the recruiting team.',
  'settled', timestamptz '2026-06-08 21:00:00+00'
) on conflict (id) do update set
  settle_state = excluded.settle_state, settled_at = excluded.settled_at, verdict = excluded.verdict,
  debrief_notes = excluded.debrief_notes, reflections = excluded.reflections, role_assignments = excluded.role_assignments,
  staff_roles = excluded.staff_roles, phases = excluded.phases, checked_in = excluded.checked_in, rsvp = excluded.rsvp;

-- Budget: under target, all paid.
insert into budget (id, event_id, currency, target_amount)
values ('bud-seed-locked', 'evt-seed-locked', 'USD', 5000)
on conflict (id) do update set target_amount = excluded.target_amount;

insert into budget_line (id, budget_id, label, confirmed_amount, payment_status) values
  ('bl-seed-1', 'bud-seed-locked', 'Venue', 2000, 'paid'),
  ('bl-seed-2', 'bud-seed-locked', 'Catering', 1500, 'paid'),
  ('bl-seed-3', 'bud-seed-locked', 'A/V', 600, 'paid'),
  ('bl-seed-4', 'bud-seed-locked', 'Photography', 500, 'paid')
on conflict (id) do nothing;

-- Deliverables: all done, incl. the non-deletable post-mortem.
insert into deliverable (id, event_id, title, phase, status, offset_start, resolved_due_date, locked) values
  ('del-seed-1', 'evt-seed-locked', 'Book venue', 'Plan it', 'Done', -30, date '2026-05-06', false),
  ('del-seed-2', 'evt-seed-locked', 'Confirm speakers', 'Plan it', 'Done', -21, date '2026-05-15', false),
  ('del-seed-3', 'evt-seed-locked', 'Send invites', 'Promote', 'Done', -14, date '2026-05-22', false),
  ('del-seed-4', 'evt-seed-locked', 'Order catering', 'Promote', 'Done', -7, date '2026-05-29', false),
  ('del-seed-5', 'evt-seed-locked', 'Run of show', 'Event day', 'Done', 0, date '2026-06-05', false),
  ('del-seed-6', 'evt-seed-locked', 'Post-event reflections & insights', 'Wrap', 'Done', 2, date '2026-06-07', true)
on conflict (id) do nothing;

-- A few attendees (dedup by email), most checked in; two tagged as candidates, one prospect.
insert into attendee (id, name, email, type) values
  ('att-seed-1', 'Priya Shah', 'priya.seedlocked@example.com', 'Unknown'),
  ('att-seed-2', 'Marcus Lee', 'marcus.seedlocked@example.com', 'Unknown'),
  ('att-seed-3', 'Dana Wu', 'dana.seedlocked@example.com', 'Partner'),
  ('att-seed-4', 'Sam Ortiz', 'sam.seedlocked@example.com', 'Unknown')
on conflict (id) do nothing;

insert into attendee_event (id, attendee_id, event_id, role_at_event, registration_status, checked_in) values
  ('ae-seed-1', 'att-seed-1', 'evt-seed-locked', 'attendee', 'approved', true),
  ('ae-seed-2', 'att-seed-2', 'evt-seed-locked', 'attendee', 'approved', true),
  ('ae-seed-3', 'att-seed-3', 'evt-seed-locked', 'speaker', 'approved', true),
  ('ae-seed-4', 'att-seed-4', 'evt-seed-locked', 'attendee', 'approved', false)
on conflict (attendee_id, event_id) do nothing;

insert into person_tag (id, attendee_id, event_id, lens, priority, note, source, source_ref, status) values
  ('ptag-seed-1', 'att-seed-1', 'evt-seed-locked', 'candidate', true,  'ML eng, actively looking — strong', 'debrief', 'debrief @ 14:02', 'confirmed'),
  ('ptag-seed-2', 'att-seed-2', 'evt-seed-locked', 'candidate', false, 'infra, curious', 'debrief', 'debrief', 'confirmed'),
  ('ptag-seed-3', 'att-seed-3', 'evt-seed-locked', 'partner',   false, 'founder, possible partner', 'debrief', 'debrief', 'confirmed')
on conflict (attendee_id, event_id, lens) do nothing;
