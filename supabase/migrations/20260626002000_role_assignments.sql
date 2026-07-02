-- Roles resolve to people at settle time (invariant: templates carry roles, not names).
-- role_assignments maps each staff role on the event → the person who filled it.
alter table event add column if not exists role_assignments jsonb not null default '{}'::jsonb;
