-- Optional link from an event to the Slack channel that discusses it.
alter table event add column if not exists slack_channel text;
create index if not exists event_slack_channel_idx on event(slack_channel);

-- Unified ledger of proposed captures pinned from Slack ("From Slack" feed).
create table if not exists slack_capture (
  id            text primary key,                  -- deterministic: eventId:channel:ts:type
  event_id      text not null references event(id) on delete cascade,
  slack_channel text not null,
  slack_ts      text not null,
  type          text not null check (type in ('note','status','debrief','people','budget','vendor','other')),
  payload       jsonb not null,
  status        text not null default 'proposed' check (status in ('proposed','dismissed','confirmed')),
  confidence    real,
  source_ref    text,
  context_ts    jsonb,
  flags         jsonb not null default '{}',
  reactor_user  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists slack_capture_event_idx on slack_capture(event_id);
create index if not exists slack_capture_status_idx on slack_capture(status);
grant select, insert, update, delete on slack_capture to anon, authenticated;
