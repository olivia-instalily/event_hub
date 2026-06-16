-- Internal profiles — a pre-auth "current user" for attribution (e.g. note
-- contributors) and the seam real auth/roles attach to later.
create table profile (
  id         text primary key,
  name       text not null,
  email      text,
  color      text,
  created_at timestamptz default now()
);

grant select, insert, update, delete on profile to anon, authenticated;
