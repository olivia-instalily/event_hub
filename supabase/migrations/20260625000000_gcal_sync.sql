-- Google Calendar sync: one toggleable secondary calendar (under calendar@instalily.ai) that
-- holds every EventHub event. gcal_event_id makes the push idempotent (insert vs patch).
alter table event add column if not exists gcal_event_id text;
create index if not exists event_gcal_idx on event (gcal_event_id);

-- Key/value app settings — holds the auto-created calendar id (gcal_calendar_id) so the sync
-- function reuses the same dedicated calendar instead of making a new one each time.
create table if not exists app_setting (
  key text primary key,
  value text
);

grant all on app_setting to anon, authenticated, service_role;
