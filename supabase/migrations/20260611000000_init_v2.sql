-- Assembly data model v2 — schema
-- Source of truth: spec/data_model_v2.md (folded against the real TTW 2026 event).
-- Principle from the spec: missing data is the NORMAL case. Almost every column is
-- nullable on purpose, and reconciliation gaps are stored, not assumed away.

-- Stages and roles are stored as TEXT (not enums) on purpose: real data carried
-- "Delivered" / "In Progress" stages the brief's pipeline didn't anticipate, and the
-- spec says the model must hold real values, not reject them.

-- ───────────────────────────────────────────────────────────── Event Series (parent)
create table event_series (
  id            text primary key,
  name          text not null,
  office        text,
  owning_team   text,
  type          text,
  start_date    date,
  end_date      date,
  status        text,
  verdict       text,              -- rollup note
  ongoing_motion text,             -- rollup note
  gaps          text[],            -- explicitly-flagged "not captured" items
  extras        jsonb,             -- attendee_observations, open_questions, deliverables_observed
  created_at    timestamptz default now()
);

-- ───────────────────────────────────────────────────────────── Event Type (template)
create table event_type (
  id                text primary key,
  name              text not null,
  vendor_categories text[],
  reflections       text[],
  created_at        timestamptz default now()
);

-- ───────────────────────────────────────────────────────────── Event
create table event (
  id                     text primary key,
  series_id              text references event_series(id),
  event_type_id          text references event_type(id),
  name                   text not null,
  format                 text,
  macro_stage            text,
  audience               text,
  event_date             date,
  location               text,
  office                 text,
  -- turnout block (spec finding #2)
  rsvp                   integer,
  capacity               integer,
  checked_in             integer,
  waitlist_admitted      integer,
  actual_attendance_note text,
  notes                  text[],
  created_at             timestamptz default now()
);

-- ───────────────────────────────────────────────────────────── Vendor (persistent)
create table vendor (
  id             text primary key,
  name           text,             -- nullable: TTW photo/video vendors had no name in recap
  category       text,
  preferred_list text,             -- e.g. "Toronto" (spec finding #4)
  notes          text,
  created_at     timestamptz default now()
);

create table vendor_contact (
  id         text primary key,
  vendor_id  text not null references vendor(id),
  name       text,
  email      text,                 -- used for email-matching later
  role       text
);

-- ───────────────────────────────────────────────────────────── Engagement (vendor decision)
-- Attachable to a Series OR an Event (spec finding #1: TTW costs sat at series level).
create table engagement (
  id               text primary key,
  series_id        text references event_series(id),
  event_id         text references event(id),
  category         text,
  vendor_id        text references vendor(id),
  stage            text,           -- Sourced→Quoted→Negotiating→Selected→Contracted (+ real: Delivered, In Progress)
  confirmed_amount numeric(12,2),
  note             text,
  created_at       timestamptz default now(),
  constraint engagement_attached_somewhere check (series_id is not null or event_id is not null)
);

-- ───────────────────────────────────────────────────────────── Contract (attached to vendor)
create table contract (
  id          text primary key,
  vendor_id   text not null references vendor(id),
  series_id   text references event_series(id),
  event_id    text references event(id),
  amount      numeric(12,2),
  signed_date date,
  expiry      date,
  status      text,
  file_url    text
);

-- ───────────────────────────────────────────────────────────── Budget
-- A budget header attaches to a series OR an event; lines hang off it.
create table budget (
  id             text primary key,
  series_id      text references event_series(id),
  event_id       text references event(id),
  currency       text default 'USD',
  reported_total numeric(12,2),    -- as stated in the recap; may not equal line sum
  constraint budget_attached_somewhere check (series_id is not null or event_id is not null)
);

create table budget_line (
  id                 text primary key,
  budget_id          text not null references budget(id),
  label              text,
  estimated_amount   numeric(12,2),
  confirmed_amount   numeric(12,2),
  linked_engagement  text references engagement(id),
  is_uncategorized   boolean default false,  -- the "Other" bucket
  note               text
);

-- ───────────────────────────────────────────────────────────── Attendee (deduped by email)
create table attendee (
  id           text primary key,
  name         text,
  email        text unique,        -- dedup key; null until Luma fills it (Postgres allows many nulls)
  title        text,
  org          text,
  type         text,               -- Client / Hire / Partner / Investor / Unknown
  is_aggregate boolean default false,  -- the ~20-30 candidate pool placeholder
  count_est    text,
  note         text,
  created_at   timestamptz default now()
);

-- Attendee↔Event join carries a ROLE (spec finding #3).
create table attendee_event (
  id            text primary key,
  attendee_id   text not null references attendee(id),
  event_id      text not null references event(id),
  role_at_event text default 'attendee',  -- attendee / speaker / judge / host
  unique (attendee_id, event_id)
);

-- ───────────────────────────────────────────────────────────── Staff (internal, not vendors)
create table staff (
  id    text primary key,
  name  text not null,
  role  text,
  email text
);

-- ───────────────────────────────────────────────────────────── Narrative carry-forwards
create table reflection (
  id            text primary key,
  series_id     text references event_series(id),
  event_type_id text references event_type(id),
  body          text not null
);

create table side_activity (
  id        text primary key,
  series_id text references event_series(id),
  name      text,
  learning  text
);

create table deliverable (
  id               text primary key,
  event_id         text references event(id),
  event_type_id    text references event_type(id),
  title            text not null,
  phase            text,
  owner_role       text,
  due_offset_days  integer,
  resolved_due_date date,
  status           text,
  linear_issue_id  text
);

-- Helpful indexes for the read paths the dashboard uses.
create index on event (series_id);
create index on engagement (series_id);
create index on engagement (event_id);
create index on engagement (vendor_id);
create index on budget_line (budget_id);
create index on attendee_event (event_id);
create index on attendee_event (attendee_id);
