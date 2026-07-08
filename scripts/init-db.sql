-- Create the PostgREST roles that Supabase normally provisions automatically.
-- Run this ONCE against the Cloud SQL instance before applying migrations.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- service_role: full access, bypasses row-level security (mirrors Supabase).
do $$ begin
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- Allow the postgres superuser to switch into these roles (required by PostgREST).
grant anon         to postgres;
grant authenticated to postgres;
grant service_role  to postgres;

-- service_role gets full CRUD on all public tables (mirrors Supabase's service_role grants).
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
