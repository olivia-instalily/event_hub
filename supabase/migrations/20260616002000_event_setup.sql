-- Event setup walkthrough: a guided first screen that grounds a freshly-created
-- template draft (date, headcount, owner, budget projection review, vendor outreach
-- intent, timeline, lessons) before handing off to the operational dashboard.

-- Event-level setup state + the fields the walkthrough collects.
alter table event add column if not exists setup_complete     boolean default false;
alter table event add column if not exists headcount          integer;           -- planning headcount target
alter table event add column if not exists event_budget_target numeric(12,2);     -- optional overarching budget
alter table event add column if not exists setup_progress     jsonb default '[]'::jsonb; -- completed step keys

-- Existing events predate the walkthrough — skip it for them.
update event set setup_complete = true where setup_complete is null or setup_complete = false;

-- Per-category optional target, separate from the projected estimate and the
-- (later) confirmed amount.
alter table budget_line add column if not exists target numeric(12,2);

-- Vendor outreach intent recorded during setup. The actual Gmail watch is a later
-- integration (V2); this just records that the user opted in per vendor.
alter table engagement add column if not exists outreach_started boolean default false;
alter table engagement add column if not exists watch_inbox      boolean default false;

-- Writable from the dashboard. event_date had no update grant before (dates were
-- only ever set on insert); the walkthrough needs to set it. budget_line and
-- deliverable already carry table-level update grants.
grant update (setup_complete, headcount, event_budget_target, setup_progress, event_date) on event to anon, authenticated;
grant update (outreach_started, watch_inbox) on engagement to anon, authenticated;
