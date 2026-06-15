-- Editable event description + general edit grant on name/description.
alter table event add column description text;
grant update (name, description) on event to anon, authenticated;

-- Labels / folders. One table, scoped to either events or people, with a join per scope.
create table label (
  id         text primary key,
  name       text not null,
  scope      text not null check (scope in ('event', 'person')),
  created_at timestamptz default now()
);

create table event_label (
  label_id text references label(id) on delete cascade,
  event_id text references event(id) on delete cascade,
  primary key (label_id, event_id)
);

create table attendee_label (
  label_id    text references label(id) on delete cascade,
  attendee_id text references attendee(id) on delete cascade,
  primary key (label_id, attendee_id)
);

create index on event_label (event_id);
create index on attendee_label (attendee_id);

-- Internal tool: the dashboard (anon) manages labels directly.
grant select, insert, update, delete on label to anon, authenticated;
grant select, insert, delete on event_label to anon, authenticated;
grant select, insert, delete on attendee_label to anon, authenticated;
