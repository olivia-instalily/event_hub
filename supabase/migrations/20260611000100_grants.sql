-- Read access for the dashboard.
-- The frontend uses the anon key and only READS. Writes (e.g. Luma upserting attendees)
-- go through the service-role key server-side, so anon gets SELECT only.
-- RLS stays disabled for now (internal tool, local dev); revisit when auth/office-scoping lands.

grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;

-- Cover any tables added by later migrations too.
alter default privileges in schema public grant select on tables to anon, authenticated;
