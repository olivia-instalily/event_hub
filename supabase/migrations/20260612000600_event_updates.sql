-- Auto-update activity feed: a log of changes detected from linked integrations
-- (email / Linear) or recorded manually, shown on the event Overview. Each row can
-- point at the engagement or deliverable it touched and link the source artifact
-- (email thread, signed contract, Linear issue).
create table event_update (
  id             text primary key,
  event_id       text not null references event(id) on delete cascade,
  source         text not null default 'manual',  -- 'email' | 'linear' | 'manual'
  summary        text not null,
  detail         text,
  link_url       text,                              -- the email / contract / Linear post
  engagement_id  text references engagement(id) on delete set null,
  deliverable_id text references deliverable(id) on delete set null,
  created_at     timestamptz default now()
);
create index on event_update (event_id);

grant select, insert, delete on event_update to anon, authenticated;
