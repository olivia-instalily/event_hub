-- Event Planning View (in-process): competing vendor candidates, budget-tracker
-- fields, an event-level owner, and the write grants the planning dashboard needs.

-- ── Competing vendor candidates for one engagement (a category decision).
-- The engagement row keeps category / stage / confirmed_amount; candidates hang off
-- it. Selecting one sets is_selected; advancing the engagement to Contracted copies
-- the selected candidate's quote into engagement.confirmed_amount (a human click).
create table engagement_candidate (
  id            text primary key,
  engagement_id text not null references engagement(id) on delete cascade,
  vendor_id     text references vendor(id),
  vendor_name   text,                 -- denormalized fallback when there's no vendor row
  quote_amount  numeric(12,2),
  is_selected   boolean default false,
  note          text,
  created_at    timestamptz default now()
);
create index on engagement_candidate (engagement_id);

-- ── Budget Tracker: committed lines carry a paid/pending status + an attached doc.
alter table budget_line add column payment_status text;   -- 'paid' | 'pending' | null (not yet committed)
alter table budget_line add column doc_url text;           -- attached contract/invoice url

-- Optional event-level budget target (variance vs committed).
alter table budget add column target_amount numeric(12,2);

-- Standalone (no-series) events can still name an owning team.
alter table event add column owning_team text;

-- ── Grants (RLS stays off; grants are the access control). These are low-stakes
-- client writes per the brief; the money-confirming action (advance to Contracted)
-- is still an explicit human click in the UI. budget_line already has full
-- table-level insert/update/delete from the editable-grants migration (covers the
-- new columns), so it isn't re-granted here.
grant select on engagement_candidate to anon, authenticated;
grant insert, update, delete on engagement_candidate to anon, authenticated;

grant insert, delete on engagement to anon, authenticated;
grant update (stage, vendor_id, confirmed_amount, note) on engagement to anon, authenticated;

grant update (target_amount) on budget to anon, authenticated;
grant update (macro_stage) on event to anon, authenticated;

grant insert, update, delete on deliverable to anon, authenticated;
