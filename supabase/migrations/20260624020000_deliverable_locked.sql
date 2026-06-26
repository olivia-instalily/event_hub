-- Non-deletable deliverables (e.g. the mandatory post-event post-mortem every event/template
-- carries). UI hides the delete affordance when locked.
alter table deliverable add column if not exists locked boolean default false;
