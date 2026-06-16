-- Managed list of event "format" (gathering type) options — add/remove from the UI.
-- The chosen value is stored on event.format (free text); this catalog is the offered set.
create table format_catalog (
  name       text primary key,
  created_at timestamptz default now()
);

grant select, insert, delete on format_catalog to anon, authenticated;

insert into format_catalog (name) values
  ('Fireside'), ('Panel'), ('Workshop'), ('Networking'), ('Summit'), ('Roundtable')
on conflict (name) do nothing;
