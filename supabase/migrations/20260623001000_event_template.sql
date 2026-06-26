-- Templates and events share one shape; is_template marks a reusable Event Type (open slots,
-- usually no date) vs a concrete instance.
alter table event add column if not exists is_template boolean default false;
