-- Hackathon moved out of the fixed tag taxonomy (see src/lib/tags.ts) and into the format catalog,
-- so it's an event "format" (gathering type) rather than a tag. Additive + idempotent.
insert into format_catalog (name) values ('Hackathon')
on conflict (name) do nothing;
