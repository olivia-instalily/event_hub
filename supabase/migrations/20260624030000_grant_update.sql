-- The local prototype runs with RLS off and grants anon/authenticated full INSERT/SELECT/
-- DELETE — but UPDATE was only granted on some tables, so updates to event, budget,
-- engagement, attendee, and series silently failed (e.g. source_materials never saved).
-- Grant UPDATE consistently across the public schema (and for future tables).
grant update on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant update on tables to anon, authenticated;
