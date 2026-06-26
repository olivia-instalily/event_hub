-- Persistence homes for prose pulled from a brief: run-of-show agenda, staffing roles
-- (the role, never a name), and reflections/guardrails. Lightweight jsonb on the event,
-- consistent with phases — these are small, event-scoped lists surfaced on the planning page.
alter table event add column if not exists agenda      jsonb default '[]'::jsonb; -- [{ time, title }]
alter table event add column if not exists staff_roles jsonb default '[]'::jsonb; -- [string]
alter table event add column if not exists reflections jsonb default '[]'::jsonb; -- [string]
