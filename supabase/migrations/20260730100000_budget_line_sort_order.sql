-- Manual ordering for budget rows (drag-to-reorder within a category / loose group). Categories
-- already order via their JSONB `order`; rows need their own column.
alter table budget_line add column if not exists sort_order numeric;

-- Seed existing rows with a stable initial order (current implicit order per budget).
with ranked as (
  select id, row_number() over (partition by budget_id order by id) as rn from budget_line
)
update budget_line b set sort_order = r.rn from ranked r where r.id = b.id and b.sort_order is null;
