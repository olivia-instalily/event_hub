-- Budget lines: a per-category web address for email-synced updates, plus a richer
-- lifecycle status (estimate → quoted → in review → paid) reusing payment_status.
alter table budget_line add column if not exists sync_url text;

-- payment_status now holds the lifecycle stage: 'estimate' | 'quoted' | 'in_review' | 'paid'.
alter table budget_line alter column payment_status set default 'estimate';
update budget_line set payment_status = 'in_review' where payment_status = 'pending';
update budget_line set payment_status = 'estimate' where payment_status is null;

-- budget_line carries table-level update grants already; sync_url is covered.
