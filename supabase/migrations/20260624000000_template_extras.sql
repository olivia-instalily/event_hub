-- Walkthrough narrative, planning heuristics, and outreach templates pulled from a brief.
-- jsonb on the event, consistent with phases/agenda — they travel with a template and are
-- copied (not referenced) when an event is spun up from it.
alter table event add column if not exists walkthrough jsonb default '[]'::jsonb; -- [{ title, rationale, phase, linkedKind, linkedLabel, isCallout }]
alter table event add column if not exists heuristics  jsonb default '[]'::jsonb; -- [string]
alter table event add column if not exists outreach    jsonb default '[]'::jsonb; -- [{ title, whenToUse, body }]
