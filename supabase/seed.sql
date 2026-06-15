-- TTW 2026 — real event data, loaded from spec/ttw_2026_seed.json
-- Dollar-quoted strings ($$...$$) throughout so apostrophes in the recap need no escaping.

-- ───────────────────────────────────────────────────────────── Series
insert into event_series (id, name, office, owning_team, type, start_date, end_date, status, verdict, ongoing_motion, gaps, extras) values (
  'ser-ttw-2026',
  $$TTW 2026 — Toronto Tech Week$$,
  $$Toronto$$,
  null,
  $$Flagship presence$$,
  null, null,
  $$Wrapped$$,
  $$Big interest confirmed; entrance strong, visibility landed. Brand pull in Toronto stronger than the proposal assumed.$$,
  $$Recurring smaller, lower-effort happy hours to keep the community warm — lower lift than flagship events.$$,
  array[$$exact dates not in recap$$, $$owning team not stated$$],
  $$ {
    "attendee_observations": {
      "overlap": "Significant overlap between Fireside and Happy Hour attendees — validates cross-event frequency tracking on real data.",
      "google_turnout": "Google showed up in force (Erchit, Naveen, Amit) — partnership is real, not theoretical."
    },
    "open_questions": [
      "How to tag/flag candidates in the portal? -> directly answered by the recruiting/Greenhouse flow (hire-typed attendee -> prospect with event tag).",
      "Recruiting Contacts list — to be populated with actual candidate records."
    ],
    "deliverables_observed": [
      "Day-of logistics, merch, and vendor coordination ran cleanly — no major breakage.",
      "(Pre-event deliverables not itemized in recap — this is a post-hoc summary.)"
    ]
  } $$::jsonb
);

-- ───────────────────────────────────────────────────────────── Events (two sub-events)
insert into event (id, series_id, name, tag, format, audience, office, location, rsvp, capacity, checked_in, waitlist_admitted, actual_attendance_note, notes) values
(
  'evt-ttw-fireside', 'ser-ttw-2026',
  $$Fireside + Roundtables$$,
  $$Fireside$$,
  $$Fireside chat (Naveen + Amit) followed by roundtable clusters$$,
  $$Balanced mix of mid-level engineers and professionals; broad career-stage range.$$,
  $$Toronto$$, $$Toronto$$,
  528, 120, 102, 200,
  $$Higher than checked-in — uncounted plus-ones and walk-ins who slipped past check-in. Room ran at/near capacity.$$,
  array[
    $$Conversation flowed naturally, as intended.$$,
    $$Front of room engaged (listening, photos, well-targeted Q&A); back of room disruptive — had to shush. Venue acoustics not ideal for a listening format.$$,
    $$Fireside length felt right standalone, but back-to-back after the presentation pushed the total content block too long; visible restlessness toward the end.$$,
    $$Roundtable format wasn't enforced — judgment call on the night given crowding and natural mingling.$$,
    $$People sought out Instalily team members organically.$$,
    $$Camera with shared prompts was the unlock — created common ground and a reason to talk to strangers.$$
  ]
),
(
  'evt-ttw-happyhour', 'ser-ttw-2026',
  $$Happy Hour$$,
  $$Happy Hour$$,
  $$Networking happy hour$$,
  $$Skewed younger and job-seeking — mostly new grads with some mid-level; clearly a networking-driven crowd.$$,
  $$Toronto$$, $$Toronto$$,
  200, null, 56, null,
  $$Higher than checked-in — some attendees missed registration.$$,
  array[$$Significant attendee overlap with the Fireside event.$$]
);

-- TTW event dates (from Luma start_at; the recap itself didn't capture exact dates).
update event set event_date = '2026-05-25' where id = 'evt-ttw-fireside';
update event set event_date = '2026-05-27' where id = 'evt-ttw-happyhour';

-- ───────────────────────────────────────────────────────────── Vendors
insert into vendor (id, name, category, preferred_list, notes) values
('ven-ace',        $$Ace$$,        $$Venue$$,       null,        $$Largest cost line. Which sub-event it served — confirm.$$),
('ven-waterworks', $$Waterworks$$, $$Venue$$,       null,        $$Which sub-event it served — confirm.$$),
('ven-photo',      null,           $$Photography$$, $$Toronto$$,  $$Name missing in recap. Vendor delivered quickly; Polina happy -> add to preferred Toronto vendor list.$$),
('ven-video',      null,           $$Videography$$, null,        $$External videographers; coordinating directly with Riley (in-house) on style and brand consistency.$$);

-- ───────────────────────────────────────────────────────────── Engagements (series-level)
insert into engagement (id, series_id, event_id, category, vendor_id, stage, confirmed_amount, note) values
('eng-ace',        'ser-ttw-2026', null, $$Venue$$,       'ven-ace',        $$Contracted$$,  23401.88, $$Sub-event attribution to confirm.$$),
('eng-waterworks', 'ser-ttw-2026', null, $$Venue$$,       'ven-waterworks', $$Contracted$$,  10535,    $$Sub-event attribution to confirm.$$),
('eng-photo',      'ser-ttw-2026', null, $$Photography$$, 'ven-photo',      $$Delivered$$,   null,     $$Cost likely inside the 'Other' line; not broken out separately.$$),
('eng-video',      'ser-ttw-2026', null, $$Videography$$, 'ven-video',      $$In Progress$$, null,     $$Post-production ongoing with Riley.$$);

-- ───────────────────────────────────────────────────────────── Budget (series-level)
insert into budget (id, series_id, currency, reported_total) values
('bud-ttw', 'ser-ttw-2026', 'USD', 38482.25);

-- Wrapped event: line amounts are actuals -> confirmed_amount. Reconciliation gap is preserved
-- (line sum 38481.88 vs reported 38482.25 = $0.37) for the UI to flag, not hide.
insert into budget_line (id, budget_id, label, confirmed_amount, linked_engagement, is_uncategorized, note) values
('bl-ace',        'bud-ttw', $$Ace$$,        23401.88, 'eng-ace',        false, null),
('bl-waterworks', 'bud-ttw', $$Waterworks$$, 10535,    'eng-waterworks', false, null),
('bl-other',      'bud-ttw', $$Other$$,      4545,     null,             true,  $$Uncategorized; likely includes photography + misc.$$);

-- ───────────────────────────────────────────────────────────── Attendees
insert into attendee (id, name, email, title, org, type, is_aggregate, count_est, note) values
('att-erchit', $$Erchit Sood$$, null, null,                                  $$Google for Startups$$, $$Partner$$, false, null,    $$Validates the Google partnership thread.$$),
('att-naveen', $$Naveen Nigam$$, null, $$Head of Developer Relations$$,       $$Google$$,              $$Partner$$, false, null,    null),
('att-amit',   $$Amit Vadi$$,   null, $$Head of Community, DeepMind DevX$$,   $$Google DeepMind$$,     $$Partner$$, false, null,    null);
-- Note: the ~20-30 candidate aggregate placeholder is intentionally NOT seeded — real
-- individuals come in via the Luma sync and replace it.

-- Attendee↔Event links carry a role + per-guest status (status null for the aggregate pool).
insert into attendee_event (id, attendee_id, event_id, role_at_event, registration_status, checked_in) values
('ae-erchit-fireside', 'att-erchit', 'evt-ttw-fireside', $$attendee$$, $$approved$$, true),
('ae-naveen-fireside', 'att-naveen', 'evt-ttw-fireside', $$speaker$$,  $$approved$$, true),
('ae-amit-fireside',   'att-amit',   'evt-ttw-fireside', $$speaker$$,  $$approved$$, true);

-- ───────────────────────────────────────────────────────────── Staff (internal, not vendors)
insert into staff (id, name, role) values
('stf-polina', $$Polina$$, $$Photography lead (ran point; managed the photo vendor)$$),
('stf-riley',  $$Riley$$,  $$In-house video / brand consistency$$);

-- ───────────────────────────────────────────────────────────── Reflections (carry-forward)
insert into reflection (id, series_id, body) values
('ref-1', 'ser-ttw-2026', $$Build overflow scenarios into the plan from day one: capacity buffers, waitlist policy, second-room or staggered-entry options. Team wasn't operationally built for overflow (528 RSVPs vs 120 cap).$$),
('ref-2', 'ser-ttw-2026', $$Presentation tech check is SEPARATE from AV check — verify sound routes correctly through the presentation (not just room speakers/mic) before doors open.$$),
('ref-3', 'ser-ttw-2026', $$Give Instalily staff real, distinct name tags so they're easy to spot in a crowded room (people sought them out organically).$$),
('ref-4', 'ser-ttw-2026', $$Keep the camera-with-shared-prompts device — it was the social unlock.$$);

-- ───────────────────────────────────────────────────────────── Side activities
insert into side_activity (id, series_id, name, learning) values
('sa-hackathon', 'ser-ttw-2026', $$Hackathon interest$$,    $$Hackathons generated active interest and quality candidates — worth prioritizing for future TTWs.$$),
('sa-campus',    'ser-ttw-2026', $$Campus walk-throughs$$,  $$Showing up at campuses without a booth didn't convert — need real booth presence to get traction.$$);

-- Contracts: none captured in the recap (flagged gap — venues were paid but no contract artifacts).


-- ─────────────────────────────────────────────── Demo in-process event (Planning View)
-- Demo in-process event for the Event Planning View. Standalone (no series);
-- engagements / budget / deliverables attach at the EVENT level.
insert into event (id, name, tag, tags, format, audience, office, location, macro_stage, owning_team, event_date, rsvp, capacity)
values ('evt-demo-fireside', 'AI Founders Fireside — Toronto', 'Fireside', '{Fireside}', 'Fireside chat', 'Founders & operators building with AI', 'Toronto', 'Toronto', 'Planning', 'Events', '2026-08-05', 64, 120)
on conflict (id) do update set macro_stage = excluded.macro_stage, tags = excluded.tags, owning_team = excluded.owning_team,
  event_date = excluded.event_date, rsvp = excluded.rsvp, capacity = excluded.capacity, location = excluded.location, format = excluded.format;

-- Vendor decisions (engagements) at varying pipeline stages.
insert into engagement (id, event_id, category, stage, confirmed_amount) values
  ('eng-demo-venue', 'evt-demo-fireside', 'Venue', 'Quoted', null),
  ('eng-demo-cater', 'evt-demo-fireside', 'Catering', 'Quoted', null),
  ('eng-demo-av',    'evt-demo-fireside', 'A/V', 'Contracted', 2200),
  ('eng-demo-photo', 'evt-demo-fireside', 'Photography', 'Sourced', null)
on conflict (id) do nothing;

-- Competing candidates w/ quotes.
insert into engagement_candidate (id, engagement_id, vendor_name, quote_amount, is_selected, link) values
  ('cand-venue-a', 'eng-demo-venue', 'Evergreen Loft', 11000, true,  'https://evergreenloft.example.com'),
  ('cand-venue-b', 'eng-demo-venue', 'Harbourfront Hall', 13500, false, 'https://harbourfronthall.example.com'),
  ('cand-cater-a', 'eng-demo-cater', 'Maple Catering', 4200, false, 'https://maplecatering.example.com'),
  ('cand-cater-b', 'eng-demo-cater', 'Bistro 88', 3800, false, 'https://bistro88.example.com'),
  ('cand-av-a',    'eng-demo-av',    'ClearSound AV', 2200, true,  'https://clearsoundav.example.com'),
  ('cand-photo-a', 'eng-demo-photo', 'Lens & Light', 1500, false, 'https://lensandlight.example.com')
on conflict (id) do nothing;

-- Event-level budget + tracker lines (one paid, one pending/committed, rest estimates).
insert into budget (id, event_id, currency, target_amount) values ('bud-demo', 'evt-demo-fireside', 'USD', 25000)
on conflict (id) do update set target_amount = excluded.target_amount;

insert into budget_line (id, budget_id, label, confirmed_amount, payment_status, linked_engagement) values
  ('bl-demo-venue',   'bud-demo', 'Venue', 11000, null, 'eng-demo-venue'),
  ('bl-demo-cater',   'bud-demo', 'Catering', 4000, null, null),
  ('bl-demo-av',      'bud-demo', 'A/V', 2200, 'pending', 'eng-demo-av'),
  ('bl-demo-deposit', 'bud-demo', 'Venue deposit', 2000, 'paid', null),
  ('bl-demo-mktg',    'bud-demo', 'Marketing', 1500, null, null)
on conflict (id) do nothing;

-- Phased deliverables (offsets resolve around the 2026-08-05 event date; one overdue).
insert into deliverable (id, event_id, title, phase, owner_role, due_offset_days, resolved_due_date, status) values
  ('del-demo-1',  'evt-demo-fireside', 'Book venue hold',            'Planning',  'Ops',          -67, '2026-05-30', 'Done'),
  ('del-demo-2',  'evt-demo-fireside', 'Open registration',          'Planning',  'Marketing',    -46, '2026-06-20', 'Done'),
  ('del-demo-3',  'evt-demo-fireside', 'Lock venue shortlist',       'Planning',  'Ops',          -58, '2026-06-08', 'In Progress'),
  ('del-demo-4',  'evt-demo-fireside', 'Speaker outreach',           'Planning',  'Partnerships', -36, '2026-06-30', 'In Progress'),
  ('del-demo-5',  'evt-demo-fireside', 'Send reminder email',        'Week-of',   'Marketing',     -5, '2026-07-31', 'Todo'),
  ('del-demo-6',  'evt-demo-fireside', 'Finalize headcount w/ caterer', 'Week-of', 'Ops',          -4, '2026-08-01', 'Todo'),
  ('del-demo-7',  'evt-demo-fireside', 'On-site A/V check',          'Event day', 'Ops',            0, '2026-08-05', 'Todo'),
  ('del-demo-8',  'evt-demo-fireside', 'Registration desk setup',    'Event day', 'Ops',            0, '2026-08-05', 'Todo'),
  ('del-demo-9',  'evt-demo-fireside', 'Send thank-you email',       'Wrap',      'Marketing',      2, '2026-08-07', 'Todo'),
  ('del-demo-10', 'evt-demo-fireside', 'Reconcile invoices',         'Wrap',      'Finance',        7, '2026-08-12', 'Todo')
on conflict (id) do nothing;
