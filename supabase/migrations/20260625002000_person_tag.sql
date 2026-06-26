-- People tagging: capture "who mattered" as structured, attributable tags.
-- A tag is EVENT-SCOPED (on the person↔event moment) with provenance, and rolls up to the
-- person (dedupe by email happens in the attendee layer). Multiple lenses per person allowed
-- (a founder can be candidate AND prospect) — one row per (attendee, event, lens).
-- Every tag is propose-then-confirm: feeders insert status='proposed'; humans confirm.

create table if not exists person_tag (
  id           text primary key,
  attendee_id  text not null references attendee(id) on delete cascade,
  event_id     text references event(id) on delete cascade,   -- event-scoped (the moment)
  lens         text not null check (lens in ('candidate','prospect','partner')),
  priority     boolean not null default false,                 -- star
  note         text,                                           -- the "why"
  follow_up    boolean not null default false,
  source       text not null default 'manual' check (source in ('debrief','slack','manual')),
  source_ref   text,                                           -- link / quote / "@14:02"
  status       text not null default 'confirmed' check (status in ('proposed','confirmed')),
  created_by   text references profile(id),
  created_at   timestamptz not null default now(),
  unique (attendee_id, event_id, lens)
);

create index if not exists person_tag_attendee_idx on person_tag(attendee_id);
create index if not exists person_tag_event_idx on person_tag(event_id);
create index if not exists person_tag_status_idx on person_tag(status);

-- Same grant posture as the rest of the public schema (RLS off; anon/authenticated CRUD).
grant select, insert, update, delete on person_tag to anon, authenticated;
