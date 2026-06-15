-- Event page ownership + dev round-trip (Assembly side). A page is either
-- 'generated' (data-bound, the default) or 'dev-owned' (code in git, deployed from
-- code). Ejecting flips it to dev-owned and freezes a World-only data snapshot;
-- regeneration then only drafts a diff, never overwrites.
alter table event add column page_ownership text not null default 'generated'; -- generated | dev-owned
alter table event add column repo_ref text;            -- e.g. events/<id>
alter table event add column last_deploy_status text;  -- none | building | preview | live | failed
alter table event add column preview_url text;
alter table event add column live_url text;
alter table event add column ejected_at timestamptz;
alter table event add column ejected_snapshot jsonb;   -- frozen World-only fields baked at eject

-- Per-event Developer permission (scoped to one event page; enforced once auth lands).
create table event_developer (
  id         text primary key,
  event_id   text not null references event(id) on delete cascade,
  email      text not null,
  created_at timestamptz default now(),
  unique (event_id, email)
);
create index on event_developer (event_id);

grant update (page_ownership, repo_ref, last_deploy_status, preview_url, live_url, ejected_at, ejected_snapshot) on event to anon, authenticated;
grant select, insert, delete on event_developer to anon, authenticated;
