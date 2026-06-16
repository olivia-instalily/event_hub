-- Allow deleting an event from the dashboard.
-- The newer satellite tables (event_owner, event_label, event_developer,
-- event_update) already declare ON DELETE CASCADE. The original init_v2 FKs do
-- not, so a delete would fail on the first referencing row. Recreate those FKs
-- with cascade (and the budget → budget_line chain) so deleting an event tears
-- down everything attached to it. Cascade deletes run as the table owner, so no
-- extra child-table delete grants are needed — only DELETE on event itself.

alter table engagement     drop constraint if exists engagement_event_id_fkey;
alter table engagement     add  constraint engagement_event_id_fkey
  foreign key (event_id) references event(id) on delete cascade;

alter table contract       drop constraint if exists contract_event_id_fkey;
alter table contract       add  constraint contract_event_id_fkey
  foreign key (event_id) references event(id) on delete cascade;

alter table budget         drop constraint if exists budget_event_id_fkey;
alter table budget         add  constraint budget_event_id_fkey
  foreign key (event_id) references event(id) on delete cascade;

alter table attendee_event drop constraint if exists attendee_event_event_id_fkey;
alter table attendee_event add  constraint attendee_event_event_id_fkey
  foreign key (event_id) references event(id) on delete cascade;

alter table deliverable    drop constraint if exists deliverable_event_id_fkey;
alter table deliverable    add  constraint deliverable_event_id_fkey
  foreign key (event_id) references event(id) on delete cascade;

-- Budget header → lines: cascade so deleting an event's budget removes its lines.
alter table budget_line    drop constraint if exists budget_line_budget_id_fkey;
alter table budget_line    add  constraint budget_line_budget_id_fkey
  foreign key (budget_id) references budget(id) on delete cascade;

-- A line may point at an engagement that's being cascaded away; null it rather
-- than block the delete.
alter table budget_line    drop constraint if exists budget_line_linked_engagement_fkey;
alter table budget_line    add  constraint budget_line_linked_engagement_fkey
  foreign key (linked_engagement) references engagement(id) on delete set null;

grant delete on event to anon, authenticated;
