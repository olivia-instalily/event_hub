-- Linear sync: one "EventHub" team holds everything; each event is a Project in that team and
-- each deliverable is an Issue in that project. Store the Linear ids/urls for idempotent
-- re-sync (create vs update) and for deep-linking from the UI.
alter table event add column if not exists linear_project_id text;
alter table event add column if not exists linear_project_url text;

-- deliverable.linear_issue_id already exists; add the web url for per-issue deep links.
alter table deliverable add column if not exists linear_issue_url text;

-- app_setting (key/value) already exists from the gcal migration — it caches the resolved
-- EventHub team id under key 'linear_team_id'.
