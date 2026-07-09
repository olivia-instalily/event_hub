-- Budget approval workflow, one row per event. Assigned amount is NOT stored here — it reuses
-- event.event_budget_target (written only via setEventBudgetTarget). See the Phase 0 design spec.
create table if not exists public.budget_approval (
  event_id          text primary key references public.event(id) on delete cascade,
  status            text not null check (status in ('submitted','assigned','declined')),
  requested_amount  numeric,
  decline_reason    text,
  decided_via       text check (decided_via in ('app','slack')),
  decider_ref       text,
  decided_at        timestamptz,
  slack_channel     text,
  slack_message_ts  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- PostgREST access. Mirrors the project's other tables (adjust roles if Cloud SQL differs).
grant all on public.budget_approval to anon, authenticated, service_role;
