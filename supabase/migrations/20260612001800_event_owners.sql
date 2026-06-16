-- An event can have multiple owners (profiles). Join table; supersedes the single
-- owner_profile_id column (left in place, additive only).
create table event_owner (
  id         text primary key,
  event_id   text not null references event(id) on delete cascade,
  profile_id text not null references profile(id) on delete cascade,
  created_at timestamptz default now(),
  unique (event_id, profile_id)
);
create index on event_owner (event_id);

grant select, insert, delete on event_owner to anon, authenticated;
