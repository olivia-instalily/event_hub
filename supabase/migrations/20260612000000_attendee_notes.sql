-- Threaded notes: each note is its own record with a contributor + timestamp.
create table attendee_note (
  id          text primary key,
  attendee_id text not null references attendee(id) on delete cascade,
  body        text not null,
  contributor text,            -- set by auth later; until then a client placeholder
  created_at  timestamptz default now()
);
create index on attendee_note (attendee_id);

-- Migrate any existing single-field notes into the thread as the first entry.
insert into attendee_note (id, attendee_id, body, contributor, created_at)
select 'note-' || gen_random_uuid()::text, id, note, null, now()
from attendee
where note is not null and btrim(note) <> '';

-- Anon can read + add notes. UPDATE/DELETE intentionally withheld — once auth lands,
-- those become author-only via RLS so only the contributor can edit/delete their entry.
grant select, insert on attendee_note to anon, authenticated;
